import type { ModelAdapter } from '../types.js';
import { prisma } from '../db/prisma.js';

// Budget arithmetic and gates shared by every kind of run (article runs and
// conversations). The gate always runs *before* a provider call.

const UTC_DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayStart(d: Date): Date {
  return new Date(Math.floor(d.getTime() / UTC_DAY_MS) * UTC_DAY_MS);
}

export function computeCostUsd(adapter: ModelAdapter, inputTokens: number, outputTokens: number): number {
  const inCost = (inputTokens / 1_000_000) * adapter.pricing.inputPerMillionTokens;
  const outCost = (outputTokens / 1_000_000) * adapter.pricing.outputPerMillionTokens;
  return inCost + outCost;
}

// Pessimistic upper bound: treat tokensPerRunMax as potentially spent at
// both input AND output rates. Not a true upper bound — input can exceed
// maxTokens — but the loosest honest estimate given what the runner knows
// before the call. Underestimating here would defeat the pre-call gate.
export function estimateRunCostUsd(adapter: ModelAdapter, maxTokens: number): number {
  const combinedRate = adapter.pricing.inputPerMillionTokens + adapter.pricing.outputPerMillionTokens;
  return (maxTokens / 1_000_000) * combinedRate;
}

export function readGlobalCap(): number {
  const raw = process.env.SAMIX_GLOBAL_DAILY_USD_MAX;
  if (raw == null || raw === '') return 5.0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 5.0;
}

export type BudgetRefusal = 'budget_exceeded' | 'global_budget_exceeded';

export interface BudgetCheck {
  agentId: string;
  dailyUsdMax: number;
  haltOnBudgetExceeded: boolean;
  /** Pre-call estimate against the model we intend to call. */
  estimatedCostUsd: number;
  /** When given, the agent's own cap must also hold for this much more spending (paid sources). */
  agentProjectedUsd?: number;
  now: Date;
}

export interface BudgetRefusalDetail {
  refusal: BudgetRefusal;
  spent: number;
  cap: number;
  estimatedCostUsd?: number;
}

// Per-agent daily cap first, then the global cap across all agents.
export async function checkBudget(c: BudgetCheck): Promise<BudgetRefusalDetail | null> {
  const periodStart = utcDayStart(c.now);
  const ledger = await prisma.budgetLedger.findUnique({
    where: { agentId_period: { agentId: c.agentId, period: periodStart } },
  });
  const spentToday = ledger?.costUsd ?? 0;
  // Without a projection the cap is "already reached"; with one, "would be passed".
  const overAgentCap =
    c.agentProjectedUsd === undefined ? spentToday >= c.dailyUsdMax : spentToday + c.agentProjectedUsd > c.dailyUsdMax;
  if (c.haltOnBudgetExceeded && c.dailyUsdMax > 0 && overAgentCap) {
    return { refusal: 'budget_exceeded', spent: spentToday, cap: c.dailyUsdMax };
  }

  const globalCap = readGlobalCap();
  const agg = await prisma.budgetLedger.aggregate({ where: { period: periodStart }, _sum: { costUsd: true } });
  const spentGlobal = agg._sum.costUsd ?? 0;
  if (globalCap > 0 && spentGlobal + c.estimatedCostUsd > globalCap) {
    return { refusal: 'global_budget_exceeded', spent: spentGlobal, cap: globalCap, estimatedCostUsd: c.estimatedCostUsd };
  }
  return null;
}

// Books the cost of a completed provider call. The money was spent whether or
// not the output turned out usable.
export async function recordSpend(
  agentId: string,
  now: Date,
  usage: { inputTokens: number; outputTokens: number },
  costUsd: number
): Promise<void> {
  const period = utcDayStart(now);
  await prisma.budgetLedger.upsert({
    where: { agentId_period: { agentId, period } },
    create: { agentId, period, tokensInput: usage.inputTokens, tokensOutput: usage.outputTokens, costUsd },
    update: {
      tokensInput: { increment: usage.inputTokens },
      tokensOutput: { increment: usage.outputTokens },
      costUsd: { increment: costUsd },
    },
  });
}
