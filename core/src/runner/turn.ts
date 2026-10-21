import { randomUUID } from 'node:crypto';
import type { Agent } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import type { NormalizedMessage } from '../types.js';

// Bookkeeping shared by the runners that answer a reader's question
// (converse.ts, orchestrate.ts): the per-agent lock, refusals, the conversation
// and its messages, and the AgentRun that records what it cost.

export const MAX_QUESTION_CHARS = 2000;
const HISTORY_TURNS = 6;

export type TurnStatus = 'success' | 'partial' | 'failed';

// One question per agent at a time, like article runs: two racing questions
// would read the same budget ledger.
const activeAgents = new Set<string>();

export function acquireAgent(slug: string): (() => void) | null {
  if (activeAgents.has(slug)) return null;
  activeAgents.add(slug);
  return () => void activeAgents.delete(slug);
}

export async function agentRowOf(slug: string): Promise<Agent> {
  const row = await prisma.agent.findUnique({ where: { slug } });
  if (!row) throw new Error(`Agent row missing for slug "${slug}" — was SkillLoader run?`);
  return row;
}

// A question that never started (busy, disabled, bad setup): one failed run
// row so it shows in the history, nothing is stored in the conversation.
export async function recordRefusal(slug: string, error: string, parentRunId?: string): Promise<{ runId: string }> {
  const agentRow = await agentRowOf(slug);
  const runId = randomUUID();
  const now = new Date();
  await prisma.agentRun.create({
    data: { id: runId, agentId: agentRow.id, parentRunId, status: 'failed', trigger: 'manual', error, startedAt: now, completedAt: now },
  });
  return { runId };
}

// Checks every question has to pass before anything else: well-formed and the
// agent is switched on.
export async function checkAsker(slug: string, question: string): Promise<{ agentRow: Agent } | { refusal: string }> {
  if (!question || question.length > MAX_QUESTION_CHARS) return { refusal: 'invalid_question' };
  const agentRow = await agentRowOf(slug);
  if (!agentRow.enabled) return { refusal: 'agent_disabled' };
  return { agentRow };
}

// The last HISTORY_TURNS successful question/answer pairs as plain text. Old
// tool results are not replayed: the model searches again if it needs facts,
// and citations are re-checked against that fresh search.
export async function loadHistory(conversationId: string): Promise<NormalizedMessage[]> {
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });
  const turns: NormalizedMessage[][] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const q = rows[i];
    const a = rows[i + 1];
    if (q?.role === 'user' && a?.role === 'assistant' && a.status === 'ok') {
      turns.push([
        { role: 'user', content: q.content },
        { role: 'assistant', content: a.content },
      ]);
    }
  }
  return turns.slice(-HISTORY_TURNS).flat();
}

export interface TurnOutcome {
  status: TurnStatus;
  error?: string;
  /** Text stored as the assistant message. */
  answer?: string;
  citations?: unknown[];
  /** Route and proposals, for the UI. */
  extra?: unknown;
  model: string | null;
  /** Stored as AgentRun.output. */
  output: unknown;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
}

export interface Turn {
  agentRow: Agent;
  runId: string;
  startedAt: Date;
  conversationId: string | null;
  history: NormalizedMessage[];
  finish(outcome: TurnOutcome): Promise<void>;
}

// Opens the AgentRun and, unless ephemeral, the conversation with the
// question stored. Null when the conversation does not belong to this agent.
export async function beginTurn(opts: {
  agentRow: Agent;
  question: string;
  conversationId?: string;
  /** Earlier turns supplied by a caller that keeps the conversation itself. */
  history?: NormalizedMessage[];
  /** No conversation or messages; only the AgentRun is kept. */
  ephemeral?: boolean;
  /** The run of the agent that handed this question over. */
  parentRunId?: string;
}): Promise<Turn | null> {
  const { agentRow, question } = opts;
  if (opts.conversationId) {
    const existing = await prisma.conversation.findFirst({ where: { id: opts.conversationId, agentId: agentRow.id } });
    if (!existing) return null;
  }
  const history = opts.history ?? (opts.conversationId ? await loadHistory(opts.conversationId) : []);

  const runId = randomUUID();
  const startedAt = new Date();
  await prisma.agentRun.create({
    data: { id: runId, agentId: agentRow.id, parentRunId: opts.parentRunId, status: 'running', trigger: 'manual', input: JSON.stringify({ question }), startedAt },
  });

  let conversationId: string | null = null;
  let userCreatedAt: Date | null = null;
  if (!opts.ephemeral) {
    conversationId =
      opts.conversationId ??
      (
        await prisma.conversation.create({
          data: { agentId: agentRow.id, title: question.length > 60 ? `${question.slice(0, 59)}…` : question },
        })
      ).id;
    userCreatedAt = (await prisma.conversationMessage.create({ data: { conversationId, role: 'user', content: question } })).createdAt;
  }

  return {
    agentRow,
    runId,
    startedAt,
    conversationId,
    history,
    async finish(o) {
      const completedAt = new Date();
      await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: o.status,
          error: o.error ?? null,
          model: o.model,
          output: JSON.stringify(o.output),
          tokensInput: o.tokensInput,
          tokensOutput: o.tokensOutput,
          costUsd: o.costUsd,
          completedAt,
        },
      });
      if (conversationId && userCreatedAt) {
        const citations = o.citations ?? [];
        await prisma.conversationMessage.create({
          data: {
            conversationId,
            role: 'assistant',
            content: o.answer ?? '',
            citations: citations.length ? JSON.stringify(citations) : null,
            extra: o.extra == null ? null : JSON.stringify(o.extra),
            status: o.status === 'success' ? 'ok' : o.status,
            agentRunId: runId,
            // Strictly after the question, so the order never depends on clock resolution.
            createdAt: new Date(Math.max(completedAt.getTime(), userCreatedAt.getTime() + 1)),
          },
        });
        await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: completedAt } });
      }
    },
  };
}
