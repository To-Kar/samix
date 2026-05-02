import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import type { Logger } from 'pino';
import type {
  FetchContext,
  NormalizedRequest,
  RunContext,
  RunResult,
  RunTrigger,
  Skill,
  SourceItem,
  SourceSpec,
} from '../types.js';
import { resolveAdapter } from '../adapters/index.js';
import { resolveFetcher } from '../sources/index.js';
import { JsonSchemaValidator } from '../output/validator.js';
import { unwrapJsonFences } from '../output/unwrap.js';
import { prisma } from '../db/prisma.js';
import { logger as rootLogger } from '../logger.js';
import {
  utcDayStart,
  computeCostUsd,
  estimateRunCostUsd,
  readGlobalCap,
  markFailed,
  buildFailureResult,
} from './utils.js';

// Module-level singleton — the compiled-schema cache is the hot path and
// must persist across runs.
const outputValidator = new JsonSchemaValidator();

export interface RunAgentOptions {
  skill: Skill;
  trigger: RunTrigger;
  input?: unknown;
  logger?: Logger;
}

// Fetch every source in the manifest, persist each fetched SourceItem as a
// SourceSnapshot row keyed to this run, and return the flat item list the
// adapter should see. A single failing fetcher doesn't kill the run — it
// logs and contributes zero items. Source-traceability is enforced at the
// output stage (step 6c), not here.
export async function fetchSources(
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
      sourceType: specTypeOf(item, specs),
      sourceName: item.sourceName,
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt,
      raw: item.raw ? JSON.stringify(item.raw) : null,
    })),
  });

  return all;
}

// Map an item back to its originating spec type. SourceItem doesn't carry
// the spec type directly; we infer from sourceName conventions. Imperfect
// but good enough for audit: RSS feed titles and arxiv: prefixes are
// distinguishable; "perplexity" is a fixed sentinel.
function specTypeOf(item: SourceItem, specs: SourceSpec[]): string {
  if (item.sourceName === 'perplexity') return 'perplexity_search';
  if (item.sourceName.startsWith('arxiv')) return 'arxiv';
  // Fallback: first RSS spec in the manifest wins. Works because we only
  // have one RSS spec per manifest in Phase 1.
  return specs.find((s) => s.type === 'rss')?.type ?? 'rss';
}

function resolveSchemaPath(skill: Skill): string | undefined {
  const p = skill.manifest.output.schemaPath;
  if (!p) return undefined;
  if (isAbsolute(p)) return p;
  return resolvePath(dirname(skill.skillMdPath), p);
}

interface ParsedArticle {
  title: string;
  summary: string;
  sourceUrl?: string;
  publishedAt?: string;
  topic?: string;
}

// Create Article rows from the validated parsed output. Returns the list
// of new article IDs. Assumes the validator already enforced the shape.
async function createArticles(runId: string, parsed: unknown): Promise<string[]> {
  if (!parsed || typeof parsed !== 'object') return [];
  const items = (parsed as { items?: ParsedArticle[] }).items;
  if (!Array.isArray(items) || items.length === 0) return [];

  const rows = items.map((item) => ({
    id: randomUUID(),
    agentRunId: runId,
    title: item.title,
    summary: item.summary,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
    topic: item.topic,
  }));

  await prisma.article.createMany({ data: rows });
  return rows.map((r) => r.id);
}

export async function runAgent(opts: RunAgentOptions): Promise<RunResult> {
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

  const adapter = resolveAdapter(skill.manifest.model.primary);

  // Global daily cap — sum across every agent's ledger for today.
  const globalCap = readGlobalCap();
  const globalSumAgg = await prisma.budgetLedger.aggregate({
    where: { period: periodStart },
    _sum: { costUsd: true },
  });
  const spentGlobal = globalSumAgg._sum.costUsd ?? 0;
  const estimatedCost = estimateRunCostUsd(adapter, skill.manifest.budget.tokensPerRunMax);

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

  const request: NormalizedRequest = {
    systemPrompt: skill.systemPrompt,
    messages: sourceItems.length
      ? [{ role: 'user', content: JSON.stringify({ items: sourceItems }, null, 2) }]
      : [],
    maxTokens: skill.manifest.budget.tokensPerRunMax || undefined,
  };

  log.info(
    { model: adapter.name, estimatedCost, spentGlobal, globalCap, sources: sourceItems.length },
    'run starting'
  );

  try {
    const response = await adapter.generate(request);
    const costUsd = computeCostUsd(
      adapter,
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
          output: rawOutput,
          tokensInput: response.usage.inputTokens,
          tokensOutput: response.usage.outputTokens,
          costUsd,
          completedAt,
        },
      });
      log.info({ costUsd }, 'run ok (no schema)');
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

    // Invalid output → status=partial, raw persisted for diagnosis, no
    // Article rows, no delivery. The run is a "we spent money but got
    // nothing usable" outcome — distinct from both success and failure.
    if (!validation.valid) {
      const errorSummary = (validation.errors ?? []).join('; ').slice(0, 2000);
      log.warn({ errors: validation.errors }, 'output_validation_failed');
      await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: 'partial',
          output: rawOutput,
          error: `schema_violation: ${errorSummary}`,
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
        error: `schema_violation: ${errorSummary}`,
        citations: response.citations,
        articleIds: [],
        startedAt,
        completedAt,
      };
    }

    // Valid output → create Article rows from parsed.items.
    const articleIds = await createArticles(runId, validation.parsed);

    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'success',
        output: rawOutput,
        tokensInput: response.usage.inputTokens,
        tokensOutput: response.usage.outputTokens,
        costUsd,
        completedAt,
      },
    });

    log.info({ costUsd, articles: articleIds.length }, 'run ok');
    return {
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
