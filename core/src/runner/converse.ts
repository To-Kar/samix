import { composeSystemPrompt } from './prompt.js';
import type { Logger } from 'pino';
import { z } from 'zod';
import { ModelWithoutToolsError, generateWithFallback, resolveAdapter } from '../adapters/index.js';
import { prisma } from '../db/prisma.js';
import { logger as rootLogger } from '../logger.js';
import { unwrapJsonFences } from '../output/unwrap.js';
import { executeTool, resolveTools } from '../tools/index.js';
import type { ToolDefinition } from '../tools/index.js';
import type { NormalizedMessage, NormalizedRequest, Skill } from '../types.js';
import { type BudgetEnvelope, checkBudget, computeCostUsd, envelopeFor, estimateRunCostUsd, recordSpend } from './budget.js';
import { acquireAgent, beginTurn, checkAsker, recordRefusal } from './turn.js';

export { MAX_QUESTION_CHARS } from './turn.js';

// "Fragen": a tool-using conversation over the collected articles
// (docs/SAMIX_PHASE_3_SPEC.md §6). Every guarantee that matters is enforced
// here in code, not asked of the model: the budget gate before each call, the
// call limits, and that every cited article was surfaced by a tool in *this*
// question.

export const MAX_MODEL_CALLS = 6;
export const MAX_TOOL_CALLS_PER_STEP = 4;
export const MAX_FULLTEXT_FETCHES = 3;

export const NOTHING_FOUND_ANSWER = 'Dazu habe ich in den gesammelten Artikeln nichts gefunden.';

const SEARCH_FIRST_REMINDER =
  'Antworte nicht aus Allgemeinwissen. Rufe zuerst search_articles auf, um in den gesammelten Artikeln zu suchen.';
const JSON_REMINDER =
  'Antworte ausschließlich mit einem JSON-Objekt der Form {"answer": "…mit [1]-Verweisen…", "sources": ["articleId", …]} und ohne weiteren Text.';

export type AskStatus = 'success' | 'partial' | 'failed';

export interface AnswerCitation {
  number: number;
  /** Id of the cited source: an article id, or a `file:` ref for project files. */
  articleId: string;
  /** Absent means an article. */
  kind?: 'file';
  /** Files: path inside the project. */
  path?: string;
  title: string;
  sourceName: string | null;
  publishedAt: Date | null;
  url: string | null;
}

export interface TraceStep {
  tool: string;
  input: unknown;
  resultCount: number;
  ms: number;
  isError?: boolean;
}

export interface AskResult {
  conversationId: string | null;
  runId: string;
  status: AskStatus;
  /** Why it did not fully succeed: budget_exceeded, ungrounded, no_valid_citations, … */
  error?: string;
  answer?: string;
  citations: AnswerCitation[];
  trace: TraceStep[];
  costUsd: number;
  model: string | null;
}

export interface AskOptions {
  skill: Skill;
  question: string;
  /** Continue this conversation; otherwise a new one is started. */
  conversationId?: string;
  /** Earlier turns supplied by a caller that keeps the conversation itself (the orchestrator). */
  history?: NormalizedMessage[];
  /** Answer without creating a conversation or messages; only the AgentRun is kept. */
  ephemeral?: boolean;
  /** Set when another agent handed this question over: the run hangs under it, and its budget caps this one. */
  delegation?: { parentRunId: string; envelope?: BudgetEnvelope };
  logger?: Logger;
}

const finalAnswerSchema = z.object({
  answer: z.string().min(1),
  sources: z.array(z.string()),
});

export async function askAgent(opts: AskOptions): Promise<AskResult> {
  const release = acquireAgent(opts.skill.id);
  if (!release) return refused(opts, 'already_running');
  try {
    return await execute(opts);
  } finally {
    release();
  }
}

async function refused(opts: AskOptions, error: string): Promise<AskResult> {
  const { runId } = await recordRefusal(opts.skill.id, error, opts.delegation?.parentRunId);
  return { conversationId: opts.conversationId ?? null, runId, status: 'failed', error, citations: [], trace: [], costUsd: 0, model: null };
}

async function execute(opts: AskOptions): Promise<AskResult> {
  const { skill } = opts;
  const question = opts.question.trim();
  const log = (opts.logger ?? rootLogger).child({ agentSlug: skill.id, trigger: 'ask' });

  const asker = await checkAsker(skill.id, question);
  if ('refusal' in asker) return refused(opts, asker.refusal);
  const { agentRow } = asker;

  let tools: ToolDefinition<never>[];
  try {
    tools = resolveTools(skill.manifest.tools ?? []);
  } catch {
    return refused(opts, 'invalid_tools');
  }
  if (tools.length === 0) return refused(opts, 'invalid_tools');

  // Refused before any call: a model that cannot call tools would answer from
  // what it remembers, which is exactly what this feature must not do.
  const primaryAdapter = resolveAdapter(skill.manifest.model.primary);
  if (!primaryAdapter.supportsTools) return refused(opts, 'model_without_tools');

  const turn = await beginTurn({
    agentRow,
    question,
    conversationId: opts.conversationId,
    history: opts.history,
    ephemeral: opts.ephemeral,
    parentRunId: opts.delegation?.parentRunId,
  });
  if (!turn) return refused(opts, 'conversation_not_found');
  const envelope = envelopeFor(skill.manifest.budget.questionUsdMax, opts.delegation?.envelope);
  const { runId, history } = turn;
  const runLog = log.child({ runId });

  const messages: NormalizedMessage[] = [...history, { role: 'user', content: question }];
  const specs = tools.map((t) => t.spec);
  const toolCtx = {
    logger: runLog,
    skills: [skill],
    allowance: { fullTextFetches: MAX_FULLTEXT_FETCHES },
  };

  const trace: TraceStep[] = [];
  const surfaced = new Set<string>();
  let modelCalls = 0;
  let tokensInput = 0;
  let tokensOutput = 0;
  let costUsd = 0;
  let servedBy: string | null = null;
  let remindedSearch = false;
  let remindedJson = false;

  const finish = async (
    status: AskStatus,
    fields: { error?: string; answer?: string; citations?: AnswerCitation[] }
  ): Promise<AskResult> => {
    const citations = fields.citations ?? [];
    await turn.finish({
      status,
      error: fields.error,
      answer: fields.answer,
      citations,
      model: servedBy,
      output: { steps: trace, modelCalls },
      tokensInput,
      tokensOutput,
      costUsd,
    });
    runLog.info({ status, error: fields.error, modelCalls, costUsd }, 'question done');
    return {
      conversationId: turn.conversationId,
      runId,
      status,
      error: fields.error,
      answer: fields.answer,
      citations,
      trace,
      costUsd,
      model: servedBy,
    };
  };

  try {
    for (;;) {
      if (modelCalls >= MAX_MODEL_CALLS) return await finish('partial', { error: 'step_limit' });

      // The gate sits before *every* call, not once per question.
      const refused = await checkBudget({
        agentId: agentRow.id,
        dailyUsdMax: skill.manifest.budget.dailyUsdMax,
        haltOnBudgetExceeded: skill.manifest.budget.haltOnBudgetExceeded,
        estimatedCostUsd: estimateRunCostUsd(primaryAdapter, skill.manifest.budget.tokensPerRunMax),
        envelope,
        now: new Date(),
      });
      if (refused) {
        runLog.warn({ ...refused }, `${refused.refusal}; stopping question`);
        return await finish('failed', { error: refused.refusal });
      }

      const request: NormalizedRequest = {
        systemPrompt: composeSystemPrompt(skill),
        messages,
        tools: specs,
        maxTokens: skill.manifest.budget.tokensPerRunMax || undefined,
        timeoutMs: skill.manifest.model.timeoutSecs ? skill.manifest.model.timeoutSecs * 1000 : undefined,
      };
      const { response, adapter } = await generateWithFallback(skill.manifest.model, request, runLog, {
        requireTools: true,
      });
      modelCalls++;
      servedBy = adapter.name;
      const callCost = computeCostUsd(adapter, response.usage.inputTokens, response.usage.outputTokens);
      tokensInput += response.usage.inputTokens;
      tokensOutput += response.usage.outputTokens;
      costUsd += callCost;
      await recordSpend(agentRow.id, new Date(), response.usage, callCost);
      envelope?.add(callCost);

      if (response.toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
        for (const [i, call] of response.toolCalls.entries()) {
          if (i >= MAX_TOOL_CALLS_PER_STEP) {
            // Every call must be answered or the provider rejects the next request.
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              content: JSON.stringify({ error: `too many tool calls at once (max ${MAX_TOOL_CALLS_PER_STEP}); ask again if needed` }),
              isError: true,
            });
            continue;
          }
          const t0 = Date.now();
          const result = await executeTool(call, tools, toolCtx);
          for (const id of result.articleIds) surfaced.add(id);
          trace.push({ tool: call.name, input: call.input, resultCount: result.resultCount, ms: Date.now() - t0, isError: result.isError });
          messages.push({ role: 'tool', toolCallId: call.id, content: result.content, isError: result.isError });
        }
        continue;
      }

      // A final answer. Without any search it could only come from memory.
      if (trace.length === 0) {
        if (remindedSearch) return await finish('partial', { error: 'ungrounded' });
        remindedSearch = true;
        messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: SEARCH_FIRST_REMINDER });
        continue;
      }

      const parsed = parseFinalAnswer(response.content);
      if (!parsed) {
        if (remindedJson) return await finish('partial', { error: 'invalid_output' });
        remindedJson = true;
        messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: JSON_REMINDER });
        continue;
      }

      // Nothing was found at all: the model's text is not shown, since there is
      // nothing it could be based on.
      if (surfaced.size === 0) return await finish('success', { answer: skill.manifest.emptyAnswer ?? NOTHING_FOUND_ANSWER });

      const checked = await checkCitations(parsed, surfaced);
      if (!checked) return await finish('partial', { error: 'no_valid_citations' });
      return await finish('success', { answer: checked.answer, citations: checked.citations });
    }
  } catch (err) {
    if (err instanceof ModelWithoutToolsError) return await finish('failed', { error: 'model_without_tools' });
    const message = err instanceof Error ? err.message : String(err);
    runLog.error({ err }, 'question failed');
    return await finish('failed', { error: message });
  }
}

function parseFinalAnswer(raw: string): z.infer<typeof finalAnswerSchema> | null {
  let json: unknown;
  try {
    json = JSON.parse(unwrapJsonFences(raw));
  } catch {
    return null;
  }
  const r = finalAnswerSchema.safeParse(json);
  return r.success ? r.data : null;
}

// Keeps only sources a tool actually returned in this question, renumbers
// them 1..n in the order the model listed them and rewrites the [n] markers
// accordingly. Markers that point nowhere are removed. Null when nothing
// citable is left.
export async function checkCitations(
  parsed: { answer: string; sources: string[] },
  surfaced: Set<string>
): Promise<{ answer: string; citations: AnswerCitation[] } | null> {
  const newNumber = new Map<string, number>();
  const oldToNew = new Map<number, number>();
  parsed.sources.forEach((id, i) => {
    if (!surfaced.has(id)) return;
    let n = newNumber.get(id);
    if (n === undefined) {
      n = newNumber.size + 1;
      newNumber.set(id, n);
    }
    oldToNew.set(i + 1, n);
  });
  if (newNumber.size === 0) return null;

  const fileIds = [...newNumber.keys()].filter((id) => id.startsWith('file:'));
  const articleIds = [...newNumber.keys()].filter((id) => !id.startsWith('file:'));
  const rows = await prisma.article.findMany({ where: { id: { in: articleIds } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const projects = await prisma.project.findMany({ where: { id: { in: fileIds.map((f) => f.split(':')[1] ?? '') } } });
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const citations: AnswerCitation[] = [];
  for (const [articleId, number] of newNumber) {
    if (articleId.startsWith('file:')) {
      const [, projectId = '', ...rest] = articleId.split(':');
      const project = projectById.get(projectId);
      const path = rest.join(':');
      if (!project || !path) continue;
      citations.push({ number, articleId, kind: 'file', path, title: path, sourceName: project.name, publishedAt: null, url: null });
      continue;
    }
    const row = byId.get(articleId);
    if (!row) continue;
    citations.push({
      number,
      articleId,
      title: row.title,
      sourceName: row.sourceName,
      publishedAt: row.publishedAt,
      url: row.sourceUrl,
    });
  }
  if (citations.length === 0) return null;

  const kept = new Set(citations.map((c) => c.number));
  const answer = parsed.answer
    .replace(/\s?\[(\d+)\]/g, (_m, d: string) => {
      const n = oldToNew.get(Number(d));
      return n !== undefined && kept.has(n) ? ` [${n}]` : '';
    })
    .trim();
  return { answer, citations };
}
