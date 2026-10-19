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

// Module-level singleton — the compiled-schema cache is the hot path and
// must persist across runs.
const outputValidator = new JsonSchemaValidator();

export interface RunAgentOptions {
  skill: Skill;
  trigger: RunTrigger;
  input?: unknown;
  logger?: Logger;
}

const UTC_DAY_MS = 24 * 60 * 60 * 1000;

function utcDayStart(d: Date): Date {
  return new Date(Math.floor(d.getTime() / UTC_DAY_MS) * UTC_DAY_MS);
}

function computeCostUsd(
  adapter: ModelAdapter,
  inputTokens: number,
  outputTokens: number
): number {
  const inCost = (inputTokens / 1_000_000) * adapter.pricing.inputPerMillionTokens;
  const outCost = (outputTokens / 1_000_000) * adapter.pricing.outputPerMillionTokens;
  return inCost + outCost;
}

// Pessimistic upper bound: treat tokensPerRunMax as potentially spent at
// both input AND output rates. Not a true upper bound — input can exceed
// maxTokens — but the loosest honest estimate given what the runner knows
// before the call. Underestimating here would defeat the pre-call gate.
function estimateRunCostUsd(adapter: ModelAdapter, maxTokens: number): number {
  const combinedRate =
    adapter.pricing.inputPerMillionTokens + adapter.pricing.outputPerMillionTokens;
  return (maxTokens / 1_000_000) * combinedRate;
}

function readGlobalCap(): number {
  const raw = process.env.SAMIX_GLOBAL_DAILY_USD_MAX;
  if (raw == null || raw === '') return 5.0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 5.0;
}

interface FailureShape {
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
    output: null,
    tokensInput: 0,
    tokensOutput: 0,
    costUsd: 0,
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
  completedAt: Date
): Promise<void> {
  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: 'failed', error, completedAt },
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
  log: Logger
): Promise<SourceItem[]> {
  const ctx: FetchContext = { runId, logger: log };
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
      log.warn(
        { type: spec.type, err: err instanceof Error ? err.message : String(err) },
        'source_fetch_failed'
      );
    }
  }

  if (all.length === 0) return all;

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

  return all;
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

  // Per-agent daily cap.
  const periodStart = utcDayStart(startedAt);
  const ledger = await prisma.budgetLedger.findUnique({
    where: { agentId_period: { agentId: agentRow.id, period: periodStart } },
  });
  const spentToday = ledger?.costUsd ?? 0;
  const dailyCap = skill.manifest.budget.dailyUsdMax;
  const halt = skill.manifest.budget.haltOnBudgetExceeded;

  if (halt && dailyCap > 0 && spentToday >= dailyCap) {
    log.warn({ spentToday, dailyCap }, 'budget_exceeded; refusing to run');
    const completedAt = new Date();
    await markFailed(runId, 'budget_exceeded', completedAt);
    return buildFailureResult({
      runId,
      agentSlug: skill.id,
      error: 'budget_exceeded',
      startedAt,
      completedAt,
    });
  }

  // Resolved up front only to price the pre-call estimate against the model
  // we intend to call. The adapter that actually serves the request is picked
  // in generateWithFallback below and may be the declared fallback instead.
  const primaryAdapter = resolveAdapter(skill.manifest.model.primary);

  // Global daily cap — sum across every agent's ledger for today.
  const globalCap = readGlobalCap();
  const globalSumAgg = await prisma.budgetLedger.aggregate({
    where: { period: periodStart },
    _sum: { costUsd: true },
  });
  const spentGlobal = globalSumAgg._sum.costUsd ?? 0;
  const estimatedCost = estimateRunCostUsd(primaryAdapter, skill.manifest.budget.tokensPerRunMax);

  if (globalCap > 0 && spentGlobal + estimatedCost > globalCap) {
    log.warn(
      { spentGlobal, estimatedCost, globalCap },
      'global_budget_exceeded; refusing to run'
    );
    const completedAt = new Date();
    await markFailed(runId, 'global_budget_exceeded', completedAt);
    return buildFailureResult({
      runId,
      agentSlug: skill.id,
      error: 'global_budget_exceeded',
      startedAt,
      completedAt,
    });
  }

  // Source fetch + snapshot persistence (only if the manifest declares any).
  let sourceItems: SourceItem[] = [];
  if (skill.manifest.sources?.length) {
    sourceItems = await fetchSources(skill.manifest.sources, runId, log);
  }

  // A skill that declares sources must have something to summarise. Calling
  // the model with nothing to ground it on costs money and invites invented
  // articles, so the run stops here, before any provider call.
  if (skill.manifest.sources?.length && sourceItems.length === 0) {
    log.warn({ sources: skill.manifest.sources.length }, 'no_source_items; refusing to call model');
    const completedAt = new Date();
    await markFailed(runId, 'no_source_items', completedAt);
    return buildFailureResult({
      runId,
      agentSlug: skill.id,
      error: 'no_source_items',
      startedAt,
      completedAt,
    });
  }

  // Everything fetched was already published by this agent recently: nothing
  // to do, and no reason to pay for a model call. Not a failure.
  const dedupeDays = skill.manifest.dedupeDays ?? DEFAULT_DEDUPE_DAYS;
  if (sourceItems.length > 0) {
    const { fresh, skipped } = await dropAlreadyPublished(agentRow.id, sourceItems, dedupeDays, startedAt);
    if (skipped > 0) log.info({ skipped, fresh: fresh.length, dedupeDays }, 'already_published_skipped');
    sourceItems = fresh;
    if (fresh.length === 0) {
      const completedAt = new Date();
      await prisma.agentRun.update({
        where: { id: runId },
        data: { status: 'success', output: JSON.stringify({ note: 'no_new_items', skipped }), completedAt },
      });
      log.info({ skipped }, 'run ok (nothing new)');
      return {
        runId,
        agentSlug: skill.id,
        status: 'success',
        output: { note: 'no_new_items', skipped },
        tokensInput: 0,
        tokensOutput: 0,
        costUsd: 0,
        citations: [],
        articleIds: [],
        startedAt,
        completedAt,
      };
    }
  }

  const request: NormalizedRequest = {
    systemPrompt: skill.systemPrompt,
    messages: sourceItems.length
      ? [{ role: 'user', content: JSON.stringify({ items: sourceItems }, null, 2) }]
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
      estimatedCost,
      spentGlobal,
      globalCap,
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
    const costUsd = computeCostUsd(
      servingAdapter,
      response.usage.inputTokens,
      response.usage.outputTokens
    );
    const completedAt = new Date();

    // Ledger always increments on a completed adapter call — the API cost
    // was incurred regardless of whether the output validates.
    await prisma.budgetLedger.upsert({
      where: { agentId_period: { agentId: agentRow.id, period: periodStart } },
      create: {
        agentId: agentRow.id,
        period: periodStart,
        tokensInput: response.usage.inputTokens,
        tokensOutput: response.usage.outputTokens,
        costUsd,
      },
      update: {
        tokensInput: { increment: response.usage.inputTokens },
        tokensOutput: { increment: response.usage.outputTokens },
        costUsd: { increment: costUsd },
      },
    });

    const schemaPath = resolveSchemaPath(skill);
    const rawOutput = JSON.stringify({
      content: response.content,
      stopReason: response.stopReason,
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