import { prisma } from '../db/prisma.js';
import type { ModelAdapter, RunResult, RunStatus } from '../types.js';

export const UTC_DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayStart(d: Date): Date {
  return new Date(Math.floor(d.getTime() / UTC_DAY_MS) * UTC_DAY_MS);
}

export function computeCostUsd(
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
export function estimateRunCostUsd(adapter: ModelAdapter, maxTokens: number): number {
  const combinedRate =
    adapter.pricing.inputPerMillionTokens + adapter.pricing.outputPerMillionTokens;
  return (maxTokens / 1_000_000) * combinedRate;
}

export function readGlobalCap(): number {
  const raw = process.env.SAMIX_GLOBAL_DAILY_USD_MAX;
  if (raw == null || raw === '') return 5.0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 5.0;
}

export async function markFailed(
  runId: string,
  error: string,
  completedAt: Date
): Promise<void> {
  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: 'failed' as RunStatus, error, completedAt },
  });
}

export interface FailureShape {
  runId: string;
  agentSlug: string;
  error: string;
  startedAt: Date;
  completedAt: Date;
}

export function buildFailureResult(f: FailureShape): RunResult {
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
