import type { ModelAdapter } from '../types.js';
import { prisma } from '../db/prisma.js';
import { GLOBAL_CAP_KEY, getPriceOverride, getSetting } from '../settings.js';

// Budget arithmetic and gates shared by every kind of run (article runs and
// conversations). The gate always runs *before* a provider call.

const UTC_DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayStart(d: Date): Date {
  return new Date(Math.floor(d.getTime() / UTC_DAY_MS) * UTC_DAY_MS);
}

// The price Samix calculates with: what the reader entered in the app, else the adapter's built-in table.
export function effectivePricing(adapter: ModelAdapter): ModelAdapter['pricing'] {
  return getPriceOverride(adapter.name) ?? adapter.pricing;
}

export function computeCostUsd(adapter: ModelAdapter, inputTokens: number, outputTokens: number): number {
  const price = effectivePricing(adapter);
  const inCost = (inputTokens / 1_000_000) * price.inputPerMillionTokens;
  const outCost = (outputTokens / 1_000_000) * price.outputPerMillionTokens;
  return inCost + outCost;
}

// Pessimistic upper bound: treat tokensPerRunMax as potentially spent at
// both input AND output rates. Not a true upper bound — input can exceed
// maxTokens — but the loosest honest estimate given what the runner knows
// before the call. Underestimating here would defeat the pre-call gate.
export function estimateRunCostUsd(adapter: ModelAdapter, maxTokens: number): number {
  const price = effectivePricing(adapter);
  const combinedRate = price.inputPerMillionTokens + price.outputPerMillionTokens;
  return (maxTokens / 1_000_000) * combinedRate;
}

// The reader's setting wins over the environment; 0 switches the global cap off.
export function readGlobalCap(): number {
  const raw = getSetting(GLOBAL_CAP_KEY) ?? process.env.SAMIX_GLOBAL_DAILY_USD_MAX;
  if (raw == null || raw === '') return 5.0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 5.0;
}

// What one question may still cost, over the agent that was asked and
// everything it delegates to. Each level has its own cap and shares its
// parent's money, so a child can never spend more than the parent has left.
// Checked in checkBudget, i.e. before the call, like the other caps.
export class BudgetEnvelope {
  private spent = 0;

  constructor(
    readonly limitUsd: number,
    private readonly parent?: BudgetEnvelope
  ) {}

  remaining(): number {
    const own = this.limitUsd - this.spent;
    return this.parent ? Math.min(own, this.parent.remaining()) : own;
  }

  /** Books a finished call here and in every level above. */
  add(costUsd: number): void {
    this.spent += costUsd;
    this.parent?.add(costUsd);
  }

  /** Without an own cap the child just shares the parent's. */
  child(limitUsd?: number): BudgetEnvelope {
    return new BudgetEnvelope(limitUsd && limitUsd > 0 ? limitUsd : Number.POSITIVE_INFINITY, this);
  }
}

// The envelope for one agent's turn: nested in its caller's, or a new root if
// the manifest sets a cap. No cap anywhere up the chain means no envelope.
export function envelopeFor(questionUsdMax: number | undefined, parent?: BudgetEnvelope): BudgetEnvelope | undefined {
  if (parent) return parent.child(questionUsdMax);
  return questionUsdMax && questionUsdMax > 0 ? new BudgetEnvelope(questionUsdMax) : undefined;
}

export type BudgetRefusal = 'budget_exceeded' | 'question_budget_exceeded' | 'global_budget_exceeded';

export interface BudgetCheck {
  agentId: string;
  dailyUsdMax: number;
  haltOnBudgetExceeded: boolean;
  /** Pre-call estimate against the model we intend to call. */
  estimatedCostUsd: number;
  /** When given, the agent's own cap must also hold for this much more spending (paid sources). */
  agentProjectedUsd?: number;
  /** The question's remaining budget across the delegation tree, if it has a cap. */
  envelope?: BudgetEnvelope;
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

  if (c.envelope && c.estimatedCostUsd > c.envelope.remaining()) {
    return { refusal: 'question_budget_exceeded', spent: spentToday, cap: c.envelope.remaining(), estimatedCostUsd: c.estimatedCostUsd };
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
