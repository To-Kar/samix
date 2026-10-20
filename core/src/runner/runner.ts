import { getArticleLanguage } from '../settings.js';
import { withArticleLanguage } from './language.js';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import type { Logger } from 'pino';
import type {
  FetchContext,
  ModelAdapter,
  NormalizedRequest,
  RunContext,
  RunResult,
  RunTrigger,
  Skill,
  SourceItem,
  SourceSpec,
} from '../types.js';
import { generateWithFallback, resolveAdapter } from '../adapters/index.js';
import { resolveFetcher } from '../sources/index.js';
import { JsonSchemaValidator } from '../output/validator.js';
import { unwrapJsonFences } from '../output/unwrap.js';
import {
  enforceTraceability,
  type ArticleCandidate,
  type TraceableArticle,
} from '../output/traceability.js';
import { prisma } from '../db/prisma.js';
import { logger as rootLogger } from '../logger.js';
import { notifyRunSuccess } from './hooks.js';
import { DEFAULT_DEDUPE_DAYS, dropAlreadyPublished } from './dedupe.js';
import { buildReaderProfile } from './profile.js';
import { focusOf } from '../skills/focus.js';
import { checkBudget, computeCostUsd, estimateRunCostUsd, recordSpend, utcDayStart } from './budget.js';

// Module-level singleton — the compiled-schema cache is the hot path and
// must persist across runs.
const outputValidator = new JsonSchemaValidator();

export interface RunAgentOptions {
  skill: Skill;
  trigger: RunTrigger;
  input?: unknown;
  logger?: Logger;
}

interface FailureShape {
  costUsd?: number;
  output?: unknown;
  runId: string;
  agentSlug: string;
  error: string;
  startedAt: Date;
  completedAt: Date;
}

function buildFailureResult(f: FailureShape): RunResult {
  return {
    runId: f.runId,
    agentSlug: f.agentSlug,
    status: 'failed',
    output: f.output ?? null,
    tokensInput: 0,
    tokensOutput: 0,
    costUsd: f.costUsd ?? 0,
    error: f.error,
    citations: [],
    articleIds: [],
    startedAt: f.startedAt,
    completedAt: f.completedAt,
  };
}

async function markFailed(
  runId: string,
  error: string,
  completedAt: Date,
  output?: unknown
): Promise<void> {
  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: 'failed', error, completedAt, ...(output === undefined ? {} : { output: JSON.stringify(output) }) },
  });
}

// Fetch every source in the manifest, persist each fetched SourceItem as a
// SourceSnapshot row keyed to this run, and return the flat item list the
// adapter should see. A single failing fetcher doesn't kill the run — it
// logs and contributes zero items. Source-traceability is enforced at the
// output stage (step 6c), not here.
async function fetchSources(
  specs: SourceSpec[],
  runId: string,
  log: Logger,
  paid: { topic?: string; reserve: (estimateUsd: number) => Promise<boolean> }
): Promise<{ items: SourceItem[]; costUsd: number; notes: string[] }> {
  let costUsd = 0;
  const notes: string[] = [];
  const ctx: FetchContext = {
    runId,
    logger: log,
    topic: paid.topic,
    reserve: (estimateUsd) => paid.reserve(costUsd + estimateUsd),
    spend: (usd, note) => {
      costUsd += usd;
      log.info({ usd, note }, 'source_cost');
    },
    note: (message) => {
      if (notes.length < 20) notes.push(message.slice(0, 300));
    },
  };
  const all: SourceItem[] = [];

  for (const spec of specs) {
    const fetcher = resolveFetcher(spec.type);
    if (!fetcher) {
      log.warn({ type: spec.type }, 'fetcher_not_registered');
      continue;
    }
    try {
      const items = await fetcher.fetch(spec.config, ctx);
      log.info({ type: spec.type, count: items.length }, 'source_fetched');
      all.push(...items);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ type: spec.type, err: message }, 'source_fetch_failed');
      ctx.note?.(`${spec.type}: ${message}`);
    }
  }

  if (all.length === 0) return { items: all, costUsd, notes };

  await prisma.sourceSnapshot.createMany({
    data: all.map((item) => ({
      agentRunId: runId,
      sourceType: item.sourceType,
      sourceName: item.sourceName,
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt,
      raw: item.raw ? JSON.stringify(item.raw) : null,
    })),
  });

  return { items: all, costUsd, notes };
}

function resolveSchemaPath(skill: Skill): string | undefined {
  const p = skill.manifest.output.schemaPath;
  if (!p) return undefined;
  if (isAbsolute(p)) return p;
  return resolvePath(dirname(skill.skillMdPath), p);
}

// Create Article rows from traceability-checked articles. Returns the new
// article IDs.
async function createArticles(
  runId: string,
  articles: TraceableArticle[]
): Promise<string[]> {
  if (articles.length === 0) return [];

  const rows = articles.map((a) => ({
    id: randomUUID(),
    agentRunId: runId,
    title: a.title,
    summary: a.summary,
    sourceUrl: a.sourceUrl,
    sourceName: a.sourceName,
    publishedAt: a.publishedAt,
    topic: a.topic,
    importance: a.importance,
    importanceReason: a.importanceReason,
    storyKey: a.storyKey,
  }));

  await prisma.article.createMany({ data: rows });
  return rows.map((r) => r.id);
}

// Pull the candidate list out of validated output. The schema already
// guarantees the shape; this only narrows the type.
function candidatesOf(parsed: unknown): ArticleCandidate[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const items = (parsed as { items?: unknown }).items;
  return Array.isArray(items) ? (items as ArticleCandidate[]) : [];
}

// One run per agent at a time. A manual run racing the cron job (or a
// catch-up) would otherwise double the spend and read a stale budget ledger.
const activeAgents = new Set<string>();

export const isAgentRunning = (slug: string): boolean => activeAgents.has(slug);

export async function runAgent(opts: RunAgentOptions): Promise<RunResult> {
  const slug = opts.skill.id;
  if (activeAgents.has(slug)) return rejectConcurrentRun(opts);
  activeAgents.add(slug);
  try {
    return await executeRun(opts);
  } finally {
    activeAgents.delete(slug);
  }
}

async function rejectConcurrentRun(opts: RunAgentOptions): Promise<RunResult> {
  const { skill, trigger } = opts;
  const runId = randomUUID();
  const log = (opts.logger ?? rootLogger).child({ runId, agentSlug: skill.id, trigger });
  const startedAt = new Date();
  const agentRow = await prisma.agent.findUnique({ where: { slug: skill.id } });
  if (!agentRow) {
    throw new Error(`Agent row missing for slug "${skill.id}" — was SkillLoader run?`);
  }
  log.warn('already_running; refusing to start a second run');
  await prisma.agentRun.create({
    data: {
      id: runId,
      agentId: agentRow.id,
      status: 'failed',
      trigger,
      error: 'already_running',
      startedAt,
      completedAt: startedAt,
    },
  });
  return buildFailureResult({
    runId,
    agentSlug: skill.id,
    error: 'already_running',
    startedAt,
    completedAt: startedAt,
  });
}

async function executeRun(opts: RunAgentOptions): Promise<RunResult> {
  const { skill, trigger, input } = opts;
  const runId = randomUUID();
  const log = (opts.logger ?? rootLogger).child({
    runId,
    agentSlug: skill.id,
    trigger,
  });
  const startedAt = new Date();
  const _ctx: RunContext = { runId, triggeredBy: trigger, input, now: startedAt };

  const agentRow = await prisma.agent.findUnique({ where: { slug: skill.id } });
  if (!agentRow) {
    throw new Error(`Agent row missing for slug "${skill.id}" — was SkillLoader run?`);
  }

  // Re-read from the database: the user may have switched the agent off.
  if (!agentRow.enabled) {
    log.warn('agent_disabled; refusing to run');
    const completedAt = new Date();
    await prisma.agentRun.create({
      data: {
        id: runId,
        agentId: agentRow.id,
        status: 'failed',
        trigger,
        error: 'agent_disabled',
        startedAt,
        completedAt,
      },
    });
    return buildFailureResult({
      runId,
      agentSlug: skill.id,
      error: 'agent_disabled',
      startedAt,
      completedAt,
    });
  }

  // Pre-create the AgentRun so SourceSnapshot rows have a valid FK target.
  // Updated in place at every terminal branch below.
  await prisma.agentRun.create({
    data: {
      id: runId,
      agentId: agentRow.id,
      status: 'running',
      trigger,
      input: input == null ? null : JSON.stringify(input),
      startedAt,
    },
  });

  const periodStart = utcDayStart(startedAt);

  // Resolved up front only to price the pre-call estimate against the model
  // we intend to call. The adapter that actually serves the request is picked
  // in generateWithFallback below and may be the declared fallback instead.
  const primaryAdapter = resolveAdapter(skill.manifest.model.primary);

  const refused = await checkBudget({
    agentId: agentRow.id,
    dailyUsdMax: skill.manifest.budget.dailyUsdMax,
    haltOnBudgetExceeded: skill.manifest.budget.haltOnBudgetExceeded,
    estimatedCostUsd: estimateRunCostUsd(primaryAdapter, skill.manifest.budget.tokensPerRunMax),
    now: startedAt,
  });
  if (refused) {
    log.warn({ ...refused }, `${refused.refusal}; refusing to run`);
    const completedAt = new Date();
    await markFailed(runId, refused.refusal, completedAt);
    return buildFailureResult({
      runId,
      agentSlug: skill.id,
      error: refused.refusal,
      startedAt,
      completedAt,
    });
  }

  // Source fetch + snapshot persistence (only if the manifest declares any).
  let sourceItems: SourceItem[] = [];
  let sourceCostUsd = 0;
  let sourceNotes: string[] = [];
  let skippedSimilar: { title: string; url: string; similarTo: string }[] = [];
  if (skill.manifest.sources?.length) {
    const fetched = await fetchSources(skill.manifest.sources, runId, log, {
      topic: skill.manifest.topic ?? focusOf(skill.systemPrompt),
      // A paid source may only spend what the agent's day and the global cap still allow,
      // leaving room for the model call that follows.
      reserve: async (projectedUsd) =>
        (await checkBudget({
          agentId: agentRow.id,
          dailyUsdMax: skill.manifest.budget.dailyUsdMax,
          haltOnBudgetExceeded: skill.manifest.budget.haltOnBudgetExceeded,
          estimatedCostUsd: projectedUsd + estimateRunCostUsd(primaryAdapter, skill.manifest.budget.tokensPerRunMax),
          agentProjectedUsd: projectedUsd + estimateRunCostUsd(primaryAdapter, skill.manifest.budget.tokensPerRunMax),
          now: startedAt,
        })) === null,
    });
    sourceItems = fetched.items;
    sourceCostUsd = fetched.costUsd;
    sourceNotes = fetched.notes;
    if (sourceCostUsd > 0) {
      // Booked at once: the money is gone whatever the model makes of the items.
      await recordSpend(agentRow.id, startedAt, { inputTokens: 0, outputTokens: 0 }, sourceCostUsd);
      await prisma.agentRun.update({ where: { id: runId }, data: { costUsd: sourceCostUsd, sourceCostUsd } });
    }
  }

  // A skill that declares sources must have something to summarise. Calling
  // the model with nothing to ground it on costs money and invites invented
  // articles, so the run stops here, before any provider call.
  if (skill.manifest.sources?.length && sourceItems.length === 0) {
    log.warn({ sources: skill.manifest.sources.length, notes: sourceNotes }, 'no_source_items; refusing to call model');
    const completedAt = new Date();
    await markFailed(runId, 'no_source_items', completedAt, { sourceNotes });
    return buildFailureResult({
      runId,
      agentSlug: skill.id,
      error: 'no_source_items',
      costUsd: sourceCostUsd,
      output: { sourceNotes },
      startedAt,
      completedAt,
    });
  }

  // Everything fetched was already published by this agent recently: nothing
  // to do, and no reason to pay for a model call. Not a failure.
  const dedupeDays = skill.manifest.dedupeDays ?? DEFAULT_DEDUPE_DAYS;
  if (sourceItems.length > 0) {
    const dropped = await dropAlreadyPublished(agentRow.id, sourceItems, dedupeDays, startedAt, {
      similar: skill.manifest.dedupeSimilar !== false,
    });
    const { fresh, skipped } = dropped;
    skippedSimilar = dropped.skippedSimilar.slice(0, 10);
    if (skipped > 0) log.info({ skipped, similar: dropped.skippedSimilar.length, fresh: fresh.length, dedupeDays }, 'already_published_skipped');
    sourceItems = fresh;
    if (fresh.length === 0) {
      const completedAt = new Date();
      await prisma.agentRun.update({
        where: { id: runId },
        data: { status: 'success', output: JSON.stringify({ note: 'no_new_items', skipped, skippedSimilar }), completedAt },
      });
      log.info({ skipped }, 'run ok (nothing new)');
      return {
        runId,
        agentSlug: skill.id,
        status: 'success',
        output: { note: 'no_new_items', skipped },
        tokensInput: 0,
        tokensOutput: 0,
        costUsd: sourceCostUsd,
        citations: [],
        articleIds: [],
        startedAt,
        completedAt,
      };
    }
  }

  // Personalisation is opt-in per agent (manifest `personalize`). Without any
  // votes there is nothing to add, and the message stays exactly as before.
  const profile = skill.manifest.personalize ? await buildReaderProfile(agentRow.id) : null;
  if (profile) {
    log.info({ liked: profile.liked.length, disliked: profile.disliked.length }, 'reader_profile_attached');
  }

  const language = getArticleLanguage();
  if (language) log.info({ language }, 'article_language');

  const request: NormalizedRequest = {
    systemPrompt: language ? withArticleLanguage(skill.systemPrompt, language) : skill.systemPrompt,
    messages: sourceItems.length
      ? [
          {
            role: 'user',
            content: JSON.stringify(profile ? { readerProfile: profile, items: sourceItems } : { items: sourceItems }, null, 2),
          },
        ]
      : [],
    maxTokens: skill.manifest.budget.tokensPerRunMax || undefined,
    timeoutMs: skill.manifest.model.timeoutSecs
      ? skill.manifest.model.timeoutSecs * 1000
      : undefined,
  };

  log.info(
    {
      model: primaryAdapter.name,
      fallback: skill.manifest.model.fallback ?? null,
      sources: sourceItems.length,
    },
    'run starting'
  );

  try {
    const {
      response,
      adapter: servingAdapter,
      primaryError,
    } = await generateWithFallback(skill.manifest.model, request, log);

    if (primaryError) {
      log.warn(
        {
          primary: primaryAdapter.name,
          served: servingAdapter.name,
          err: primaryError.message,
        },
        'adapter_fallback_used'
      );
    }

    // Priced against the adapter that actually served the request, not the
    // primary: fallback pricing differs (Ollama runs locally, so zero).
    const modelCostUsd = computeCostUsd(
      servingAdapter,
      response.usage.inputTokens,
      response.usage.outputTokens
    );
    // What the run cost altogether: paid sources plus the model.
    const costUsd = modelCostUsd + sourceCostUsd;
    const completedAt = new Date();

    // Ledger always increments on a completed adapter call — the API cost
    // was incurred regardless of whether the output validates.
    await recordSpend(agentRow.id, startedAt, response.usage, modelCostUsd);

    const schemaPath = resolveSchemaPath(skill);
    const rawOutput = JSON.stringify({
      content: response.content,
      stopReason: response.stopReason,
      ...(skippedSimilar.length ? { skippedSimilar } : {}),
    });

    // No schema declared → no validation, no articles, status=success.
    // Skills like hello-world take this path.
    if (!schemaPath) {
      await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: 'success',
          model: servingAdapter.name,
          output: rawOutput,
          tokensInput: response.usage.inputTokens,
          tokensOutput: response.usage.outputTokens,
          costUsd,
          completedAt,
        },
      });
      log.info({ costUsd, model: servingAdapter.name }, 'run ok (no schema)');
      return {
        runId,
        agentSlug: skill.id,
        status: 'success',
        output: { content: response.content, stopReason: response.stopReason },
        tokensInput: response.usage.inputTokens,
        tokensOutput: response.usage.outputTokens,
        costUsd,
        citations: response.citations,
        articleIds: [],
        startedAt,
        completedAt,
      };
    }

    const validation = await outputValidator.validate(
      unwrapJsonFences(response.content),
      schemaPath
    );

    // Unusable output → status=partial, raw persisted for diagnosis, no
    // Article rows. A "we spent money but got nothing usable" outcome —
    // distinct from both success and failure.
    const finishPartial = async (error: string): Promise<RunResult> => {
      await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: 'partial',
          model: servingAdapter.name,
          output: rawOutput,
          error,
          tokensInput: response.usage.inputTokens,
          tokensOutput: response.usage.outputTokens,
          costUsd,
          completedAt,
        },
      });
      return {
        runId,
        agentSlug: skill.id,
        status: 'partial',
        output: { content: response.content, stopReason: response.stopReason },
        tokensInput: response.usage.inputTokens,
        tokensOutput: response.usage.outputTokens,
        costUsd,
        error,
        citations: response.citations,
        articleIds: [],
        startedAt,
        completedAt,
      };
    };

    if (!validation.valid) {
      const errorSummary = (validation.errors ?? []).join('; ').slice(0, 2000);
      log.warn(
        { errors: validation.errors, model: servingAdapter.name },
        'output_validation_failed'
      );
      return finishPartial(`schema_violation: ${errorSummary}`);
    }

    // Schema-valid is not the same as traceable: every article must point at
    // an item this run actually fetched, and carry a publication date.
    const candidates = candidatesOf(validation.parsed);
    const { accepted, rejected } = enforceTraceability(candidates, sourceItems);
    if (rejected.length > 0) {
      log.warn(
        { rejected, accepted: accepted.length, model: servingAdapter.name },
        'articles_rejected_untraceable'
      );
    }
    const minItems = skill.manifest.output.minItems ?? 1;
    if (accepted.length < minItems) {
      return finishPartial(
        `traceability: ${accepted.length} of ${candidates.length} articles traceable, need ${minItems}` +
          (rejected.length
            ? ` (rejected: ${rejected.map((r) => r.reason).join(', ')})`.slice(0, 500)
            : '')
      );
    }

    const articleIds = await createArticles(runId, accepted);

    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'success',
        model: servingAdapter.name,
        output: rawOutput,
        tokensInput: response.usage.inputTokens,
        tokensOutput: response.usage.outputTokens,
        costUsd,
        completedAt,
      },
    });

    log.info(
      { costUsd, model: servingAdapter.name, articles: articleIds.length },
      'run ok'
    );
    const result: RunResult = {
      runId,
      agentSlug: skill.id,
      status: 'success',
      output: { content: response.content, stopReason: response.stopReason },
      tokensInput: response.usage.inputTokens,
      tokensOutput: response.usage.outputTokens,
      costUsd,
      citations: response.citations,
      articleIds,
      startedAt,
      completedAt,
    };
    notifyRunSuccess(result, skill, (err) =>
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'run_success_hook_failed')
    );
    return result;
  } catch (err) {
    const completedAt = new Date();
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'run failed');
    await markFailed(runId, message, completedAt);
    return buildFailureResult({
      runId,
      agentSlug: skill.id,
      error: message,
      startedAt,
      completedAt,
    });
  }
}