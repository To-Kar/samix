import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { NormalizedRequest, QueryResult, Skill, SourceItem } from '../types.js';
import { resolveAdapter } from '../adapters/index.js';
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
import { fetchSources } from './runner.js';

export interface QueryAgentOptions {
  skill: Skill;
  message: string;
  logger?: Logger;
}

function formatWorkspaceContext(items: SourceItem[]): string {
  if (items.length === 0) return '';
  const blocks = items.map((item) => {
    const content = (item.raw as { content?: string } | undefined)?.content ?? item.snippet ?? '';
    return `### ${item.url}\n\`\`\`\n${content}\n\`\`\``;
  });
  return `Here are the relevant workspace files:\n\n${blocks.join('\n\n')}`;
}

export async function queryAgent(opts: QueryAgentOptions): Promise<QueryResult> {
  const { skill, message } = opts;
  const runId = randomUUID();
  const log = (opts.logger ?? rootLogger).child({
    runId,
    agentSlug: skill.id,
    trigger: 'query',
  });
  const startedAt = new Date();

  const agentRow = await prisma.agent.findUnique({ where: { slug: skill.id } });
  if (!agentRow) {
    throw new Error(`Agent row missing for slug "${skill.id}" — was SkillLoader run?`);
  }

  await prisma.agentRun.create({
    data: {
      id: runId,
      agentId: agentRow.id,
      status: 'running',
      trigger: 'query',
      input: JSON.stringify({ message }),
      startedAt,
    },
  });

  const periodStart = utcDayStart(startedAt);
  const ledger = await prisma.budgetLedger.findUnique({
    where: { agentId_period: { agentId: agentRow.id, period: periodStart } },
  });
  const spentToday = ledger?.costUsd ?? 0;
  const dailyCap = skill.manifest.budget.dailyUsdMax;
  const halt = skill.manifest.budget.haltOnBudgetExceeded;

  if (halt && dailyCap > 0 && spentToday >= dailyCap) {
    log.warn({ spentToday, dailyCap }, 'budget_exceeded; refusing query');
    const completedAt = new Date();
    await markFailed(runId, 'budget_exceeded', completedAt);
    return buildQueryFailure({ runId, agentSlug: skill.id, error: 'budget_exceeded', startedAt, completedAt });
  }

  const adapter = resolveAdapter(skill.manifest.model.primary);

  const globalCap = readGlobalCap();
  const globalSumAgg = await prisma.budgetLedger.aggregate({
    where: { period: periodStart },
    _sum: { costUsd: true },
  });
  const spentGlobal = globalSumAgg._sum.costUsd ?? 0;
  const estimatedCost = estimateRunCostUsd(adapter, skill.manifest.budget.tokensPerRunMax);

  if (globalCap > 0 && spentGlobal + estimatedCost > globalCap) {
    log.warn({ spentGlobal, estimatedCost, globalCap }, 'global_budget_exceeded; refusing query');
    const completedAt = new Date();
    await markFailed(runId, 'global_budget_exceeded', completedAt);
    return buildQueryFailure({ runId, agentSlug: skill.id, error: 'global_budget_exceeded', startedAt, completedAt });
  }

  // Fetch workspace context if sources are configured.
  let workspaceItems: SourceItem[] = [];
  if (skill.manifest.sources?.length) {
    workspaceItems = await fetchSources(skill.manifest.sources, runId, log);
  }

  const messages: NormalizedRequest['messages'] = [];
  const contextBlock = formatWorkspaceContext(workspaceItems);
  if (contextBlock) {
    messages.push({ role: 'user', content: contextBlock });
    messages.push({ role: 'assistant', content: 'I have reviewed the workspace files. What would you like to know?' });
  }
  messages.push({ role: 'user', content: message });

  const request: NormalizedRequest = {
    systemPrompt: skill.systemPrompt,
    messages,
    maxTokens: skill.manifest.budget.tokensPerRunMax || undefined,
  };

  log.info({ model: adapter.name, estimatedCost, workspaceFiles: workspaceItems.length }, 'query starting');

  try {
    const response = await adapter.generate(request);
    const costUsd = computeCostUsd(adapter, response.usage.inputTokens, response.usage.outputTokens);
    const completedAt = new Date();

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

    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'success',
        output: JSON.stringify({ content: response.content, stopReason: response.stopReason }),
        tokensInput: response.usage.inputTokens,
        tokensOutput: response.usage.outputTokens,
        costUsd,
        completedAt,
      },
    });

    log.info({ costUsd }, 'query ok');
    return {
      runId,
      agentSlug: skill.id,
      status: 'success',
      content: response.content,
      tokensInput: response.usage.inputTokens,
      tokensOutput: response.usage.outputTokens,
      costUsd,
      startedAt,
      completedAt,
    };
  } catch (err) {
    const completedAt = new Date();
    const errMessage = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'query failed');
    await markFailed(runId, errMessage, completedAt);
    return buildQueryFailure({ runId, agentSlug: skill.id, error: errMessage, startedAt, completedAt });
  }
}

function buildQueryFailure(f: {
  runId: string;
  agentSlug: string;
  error: string;
  startedAt: Date;
  completedAt: Date;
}): QueryResult {
  // Use buildFailureResult shape but adapt to QueryResult.
  const base = buildFailureResult(f);
  return {
    runId: base.runId,
    agentSlug: base.agentSlug,
    status: 'failed',
    content: '',
    tokensInput: 0,
    tokensOutput: 0,
    costUsd: 0,
    error: f.error,
    startedAt: f.startedAt,
    completedAt: f.completedAt,
  };
}
