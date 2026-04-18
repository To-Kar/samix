import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type {
  ModelAdapter,
  NormalizedRequest,
  RunContext,
  RunResult,
  RunTrigger,
  Skill,
} from '../types.js';
import { resolveAdapter } from '../adapters/index.js';
import { prisma } from '../db/prisma.js';
import { logger as rootLogger } from '../logger.js';

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

export async function runAgent(opts: RunAgentOptions): Promise<RunResult> {
  const { skill, trigger, input } = opts;
  const runId = randomUUID();
  const log = (opts.logger ?? rootLogger).child({
    runId,
    agentSlug: skill.id,
    trigger,
  });
  const startedAt = new Date();
  const ctx: RunContext = { runId, triggeredBy: trigger, input, now: startedAt };

  const agentRow = await prisma.agent.findUnique({ where: { slug: skill.id } });
  if (!agentRow) {
    throw new Error(`Agent row missing for slug "${skill.id}" — was SkillLoader run?`);
  }

  const periodStart = utcDayStart(startedAt);
  const ledger = await prisma.budgetLedger.findUnique({
    where: {
      agentId_period: { agentId: agentRow.id, period: periodStart },
    },
  });
  const spentToday = ledger?.costUsd ?? 0;
  const dailyCap = skill.manifest.budget.dailyUsdMax;
  const halt = skill.manifest.budget.haltOnBudgetExceeded;

  if (halt && dailyCap > 0 && spentToday >= dailyCap) {
    log.warn({ spentToday, dailyCap }, 'budget_exceeded; refusing to run');
    const completedAt = new Date();
    const failed = await prisma.agentRun.create({
      data: {
        id: runId,
        agentId: agentRow.id,
        status: 'failed',
        trigger,
        input: input == null ? null : JSON.stringify(input),
        error: 'budget_exceeded',
        startedAt,
        completedAt,
      },
    });
    return {
      runId: failed.id,
      agentSlug: skill.id,
      status: 'failed',
      output: null,
      tokensInput: 0,
      tokensOutput: 0,
      costUsd: 0,
      error: 'budget_exceeded',
      citations: [],
      startedAt,
      completedAt,
    };
  }

  const adapter = resolveAdapter(skill.manifest.model.primary);
  const request: NormalizedRequest = {
    systemPrompt: skill.systemPrompt,
    messages: [],
    maxTokens: skill.manifest.budget.tokensPerRunMax || undefined,
  };

  log.info({ model: adapter.name }, 'run starting');

  try {
    const response = await adapter.generate(request);
    const costUsd = computeCostUsd(
      adapter,
      response.usage.inputTokens,
      response.usage.outputTokens
    );
    const completedAt = new Date();

    const run = await prisma.agentRun.create({
      data: {
        id: runId,
        agentId: agentRow.id,
        status: 'success',
        trigger,
        input: input == null ? null : JSON.stringify(input),
        output: JSON.stringify({
          content: response.content,
          stopReason: response.stopReason,
        }),
        tokensInput: response.usage.inputTokens,
        tokensOutput: response.usage.outputTokens,
        costUsd,
        startedAt,
        completedAt,
      },
    });

    await prisma.budgetLedger.upsert({
      where: {
        agentId_period: { agentId: agentRow.id, period: periodStart },
      },
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

    log.info(
      {
        tokensInput: response.usage.inputTokens,
        tokensOutput: response.usage.outputTokens,
        costUsd,
      },
      'run ok'
    );

    return {
      runId: run.id,
      agentSlug: skill.id,
      status: 'success',
      output: { content: response.content, stopReason: response.stopReason },
      tokensInput: response.usage.inputTokens,
      tokensOutput: response.usage.outputTokens,
      costUsd,
      citations: response.citations,
      startedAt,
      completedAt,
    };
  } catch (err) {
    const completedAt = new Date();
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'run failed');

    await prisma.agentRun.create({
      data: {
        id: runId,
        agentId: agentRow.id,
        status: 'failed',
        trigger,
        input: input == null ? null : JSON.stringify(input),
        error: message,
        startedAt,
        completedAt,
      },
    });

    return {
      runId,
      agentSlug: skill.id,
      status: 'failed',
      output: null,
      tokensInput: 0,
      tokensOutput: 0,
      costUsd: 0,
      error: message,
      citations: [],
      startedAt,
      completedAt,
    };
  }
}
