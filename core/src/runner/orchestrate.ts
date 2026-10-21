import { composeSystemPrompt } from './prompt.js';
import type { Logger } from 'pino';
import { z } from 'zod';
import { ModelWithoutToolsError, generateWithFallback, resolveAdapter } from '../adapters/index.js';
import { prisma } from '../db/prisma.js';
import { logger as rootLogger } from '../logger.js';
import { listNotes } from '../memory/notes.js';
import type { NormalizedMessage, NormalizedRequest, RouteName, Skill, ToolCall, ToolSpec } from '../types.js';
import { MAX_DELEGATION_DEPTH } from '../skills/hierarchy.js';
import { type BudgetEnvelope, checkBudget, computeCostUsd, envelopeFor, estimateRunCostUsd, recordSpend } from './budget.js';
import { askAgent, type AnswerCitation, type AskResult, type TraceStep } from './converse.js';
import { MAX_QUESTION_CHARS, acquireAgent, beginTurn, checkAsker, recordRefusal } from './turn.js';

// The orchestrator: one entry point for the reader's questions. A single model
// call picks exactly one action (docs/SAMIX_PHASE_4_SPEC.md §5); the core
// carries it out and what the reader sees comes from that action, never from
// text the orchestrator model wrote. Nothing with a cost or side effect starts
// on the model's say-so: a refresh is only proposed.

// First call plus one reminder.
export const MAX_ROUTING_CALLS = 2;

const CHOOSE_REMINDER = 'Wähle genau eine Aktion, indem du eines der Werkzeuge aufrufst. Antworte nicht mit Text.';

export interface Proposal {
  kind: 'refresh';
  ressort: string;
  title: string;
}

export interface RouteInfo {
  kind: RouteName;
  /** The agent the question was handed to. */
  agent?: string;
  /** Every agent below this router the question passed through, ending at the one that answered. */
  path?: string[];
}

// Who handled a question, as a tree: this agent's own calls and what it cost,
// and the agents it handed the question to.
export interface DelegationNode {
  agent: string;
  runId: string;
  status: 'success' | 'partial' | 'failed';
  /** Of this agent's own model calls, not including its children. */
  costUsd: number;
  error?: string;
  children: DelegationNode[];
}

export interface RouteResult extends AskResult {
  route?: RouteInfo;
  proposals: Proposal[];
  delegateRunId?: string;
  delegation?: DelegationNode;
}

export interface RouteOptions {
  skill: Skill;
  question: string;
  conversationId?: string;
  /** Every loaded agent: delegates and Ressorts are looked up here. */
  skills: Skill[];
  /** Earlier turns supplied by a caller that keeps the conversation itself (a router above). */
  history?: NormalizedMessage[];
  /** Answer without creating a conversation or messages; only the AgentRun is kept. */
  ephemeral?: boolean;
  /** Set when a router above handed the question over. `path` is the agents above this one. */
  delegation?: { parentRunId: string; envelope?: BudgetEnvelope; path: string[] };
  logger?: Logger;
}

const delegateInput = z.object({ agent: z.string().min(1), question: z.string().trim().min(1).max(MAX_QUESTION_CHARS) }).strict();
const emptyInput = z.object({}).strict();
const refreshInput = z.object({ ressort: z.string().trim().min(1).max(80) }).strict();

export async function routeQuestion(opts: RouteOptions): Promise<RouteResult> {
  const release = acquireAgent(opts.skill.id);
  if (!release) return refused(opts, 'already_running');
  try {
    return await execute(opts);
  } finally {
    release();
  }
}

async function refused(opts: RouteOptions, error: string): Promise<RouteResult> {
  const { runId } = await recordRefusal(opts.skill.id, error, opts.delegation?.parentRunId);
  return { conversationId: opts.conversationId ?? null, runId, status: 'failed', error, citations: [], trace: [], costUsd: 0, model: null, proposals: [] };
}

function routeSpecs(skill: Skill, skills: Skill[]): ToolSpec[] {
  const routes = skill.manifest.routes ?? [];
  const delegates = (skill.manifest.delegates ?? []).flatMap((slug) => {
    const s = skills.find((x) => x.id === slug && x.type === 'reactive');
    return s ? [s] : [];
  });
  const ressorts = skills.filter((s) => s.type === 'proactive' && s.enabled);
  const specs: ToolSpec[] = [];
  if (routes.includes('delegate') && delegates.length > 0) {
    specs.push({
      name: 'delegate',
      description: `Hand the reader's question to a specialist agent and show its answer. Agents: ${delegates.map((d) => `${d.id} (${d.description})`).join('; ')}`,
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: delegates.map((d) => d.id) },
          question: { type: 'string', description: 'The question for the agent, self-contained, in the reader\'s language.' },
        },
        required: ['agent', 'question'],
        additionalProperties: false,
      },
    });
  }
  if (routes.includes('show_notes')) {
    specs.push({
      name: 'show_notes',
      description: 'Show the reader the notes they have saved (what the reader asked to be remembered).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    });
  }
  if (routes.includes('propose_refresh') && ressorts.length > 0) {
    specs.push({
      name: 'propose_refresh',
      description: `Offer to fetch new articles for a Ressort now. This only proposes; the reader confirms. Ressorts: ${ressorts.map((r) => `${r.id} (${r.title})`).join('; ')}`,
      inputSchema: {
        type: 'object',
        properties: { ressort: { type: 'string', enum: ressorts.map((r) => r.id) } },
        required: ['ressort'],
        additionalProperties: false,
      },
    });
  }
  return specs;
}

async function execute(opts: RouteOptions): Promise<RouteResult> {
  const { skill, skills } = opts;
  const question = opts.question.trim();
  const log = (opts.logger ?? rootLogger).child({ agentSlug: skill.id, trigger: 'route' });

  const asker = await checkAsker(skill.id, question);
  if ('refusal' in asker) return refused(opts, asker.refusal);

  const specs = routeSpecs(skill, skills);
  if (specs.length === 0) return refused(opts, 'invalid_routes');

  const primaryAdapter = resolveAdapter(skill.manifest.model.primary);
  if (!primaryAdapter.supportsTools) return refused(opts, 'model_without_tools');

  const turn = await beginTurn({
    agentRow: asker.agentRow,
    question,
    conversationId: opts.conversationId,
    history: opts.history,
    ephemeral: opts.ephemeral,
    parentRunId: opts.delegation?.parentRunId,
  });
  if (!turn) return refused(opts, 'conversation_not_found');
  const envelope = envelopeFor(skill.manifest.budget.questionUsdMax, opts.delegation?.envelope);
  const path = [...(opts.delegation?.path ?? []), skill.id];
  const runLog = log.child({ runId: turn.runId });

  const trace: TraceStep[] = [];
  let modelCalls = 0;
  let tokensInput = 0;
  let tokensOutput = 0;
  let costUsd = 0;
  let servedBy: string | null = null;

  // `own` = what the routing call cost; the delegate's run carries its own cost.
  let delegateCost = 0;
  let delegateRunId: string | undefined;
  let route: RouteInfo | undefined;
  let proposals: Proposal[] = [];
  let children: DelegationNode[] = [];

  const finish = async (
    status: 'success' | 'partial' | 'failed',
    f: { error?: string; answer?: string; citations?: AnswerCitation[] }
  ): Promise<RouteResult> => {
    const citations = f.citations ?? [];
    const totalCostUsd = costUsd + delegateCost;
    const delegation: DelegationNode = { agent: skill.id, runId: turn.runId, status, costUsd, error: f.error, children };
    await turn.finish({
      status,
      error: f.error,
      answer: f.answer,
      citations,
      extra: { route, proposals, delegateRunId, totalCostUsd, delegation },
      model: servedBy,
      output: { steps: trace, modelCalls, delegateRunId },
      tokensInput,
      tokensOutput,
      costUsd,
    });
    runLog.info({ status, error: f.error, route, modelCalls, totalCostUsd }, 'routed question done');
    return {
      conversationId: turn.conversationId,
      runId: turn.runId,
      status,
      error: f.error,
      answer: f.answer,
      citations,
      trace,
      costUsd: totalCostUsd,
      model: servedBy,
      route,
      proposals,
      delegateRunId,
      delegation,
    };
  };

  const messages: NormalizedMessage[] = [...turn.history, { role: 'user', content: question }];

  try {
    for (;;) {
      if (modelCalls >= MAX_ROUTING_CALLS) return await finish('partial', { error: 'no_route' });

      const refusal = await checkBudget({
        agentId: turn.agentRow.id,
        dailyUsdMax: skill.manifest.budget.dailyUsdMax,
        haltOnBudgetExceeded: skill.manifest.budget.haltOnBudgetExceeded,
        estimatedCostUsd: estimateRunCostUsd(primaryAdapter, skill.manifest.budget.tokensPerRunMax),
        envelope,
        now: new Date(),
      });
      if (refusal) return await finish('failed', { error: refusal.refusal });

      const request: NormalizedRequest = {
        systemPrompt: composeSystemPrompt(skill),
        messages,
        tools: specs,
        maxTokens: skill.manifest.budget.tokensPerRunMax || undefined,
        timeoutMs: skill.manifest.model.timeoutSecs ? skill.manifest.model.timeoutSecs * 1000 : undefined,
      };
      const { response, adapter } = await generateWithFallback(skill.manifest.model, request, runLog, { requireTools: true });
      modelCalls++;
      servedBy = adapter.name;
      const callCost = computeCostUsd(adapter, response.usage.inputTokens, response.usage.outputTokens);
      tokensInput += response.usage.inputTokens;
      tokensOutput += response.usage.outputTokens;
      costUsd += callCost;
      await recordSpend(turn.agentRow.id, new Date(), response.usage, callCost);
      envelope?.add(callCost);

      if (response.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: CHOOSE_REMINDER });
        continue;
      }

      // Exactly one action: the first call that is valid. Others are ignored.
      const [first, ...ignored] = response.toolCalls;
      const parsed = first ? parseRoute(first, specs, skill) : null;
      if (!first || !parsed || 'error' in parsed) {
        messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
        for (const c of response.toolCalls) {
          messages.push({
            role: 'tool',
            toolCallId: c.id,
            content: JSON.stringify({ error: parsed && 'error' in parsed ? parsed.error : 'invalid call' }),
            isError: true,
          });
        }
        trace.push({ tool: `route:${first?.name ?? '?'}`, input: first?.input, resultCount: 0, ms: 0, isError: true });
        continue;
      }

      const t0 = Date.now();
      route = { kind: parsed.kind, ...(parsed.kind === 'delegate' ? { agent: parsed.agent } : {}) };
      trace.push({ tool: `route:${parsed.kind}`, input: first.input, resultCount: 1, ms: Date.now() - t0 });
      if (ignored.length) trace.push({ tool: 'route:ignored', input: ignored.map((c) => c.name), resultCount: ignored.length, ms: 0 });

      if (parsed.kind === 'show_notes') {
        const notes = await listNotes();
        return await finish('success', {
          answer: notes.length ? `Das habe ich mir gemerkt:\n${notes.map((n) => `• ${n.text}`).join('\n')}` : 'Es sind noch keine Notizen gespeichert.',
        });
      }

      if (parsed.kind === 'propose_refresh') {
        const target = skills.find((s) => s.id === parsed.ressort && s.type === 'proactive');
        const row = target ? await prisma.agent.findUnique({ where: { slug: target.id } }) : null;
        if (!target || !row?.enabled) return await finish('failed', { error: 'unknown_ressort' });
        proposals = [{ kind: 'refresh', ressort: target.id, title: target.title }];
        return await finish('success', {
          answer: `Ich kann für „${target.title}“ jetzt neue Artikel holen. Das ruft die Quellen ab und kostet Modellaufrufe. Bestätige mit dem Knopf unten.`,
        });
      }

      // delegate
      const target = skills.find((s) => s.id === parsed.agent && s.type === 'reactive');
      if (!target) return await finish('failed', { error: 'delegate_unavailable' });
      // Another router: the question goes one level further down. The tree is
      // checked when the agents load; the path is checked again here because
      // the manifests are the reader's to edit.
      if (target.manifest.routes?.length) {
        if (path.includes(target.id)) return await finish('failed', { error: 'delegation_cycle' });
        if (path.length >= MAX_DELEGATION_DEPTH) return await finish('failed', { error: 'delegation_too_deep' });
        const sub = await routeQuestion({
          skill: target,
          question: parsed.question,
          skills,
          history: turn.history,
          ephemeral: true,
          delegation: { parentRunId: turn.runId, envelope, path },
          logger: runLog,
        });
        delegateCost = sub.costUsd;
        delegateRunId = sub.runId;
        if (sub.delegation) children = [sub.delegation];
        proposals = sub.proposals;
        route = { kind: 'delegate', agent: target.id, path: [target.id, ...(sub.route?.path ?? (sub.route?.agent ? [sub.route.agent] : []))] };
        for (const s of sub.trace) trace.push({ ...s, tool: `${target.id} › ${s.tool}` });
        return await finish(sub.status, { error: sub.error, answer: sub.answer, citations: sub.citations });
      }

      const sub = await askAgent({
        skill: target,
        question: parsed.question,
        history: turn.history,
        ephemeral: true,
        delegation: { parentRunId: turn.runId, envelope },
        logger: runLog,
      });
      delegateCost = sub.costUsd;
      delegateRunId = sub.runId;
      children = [{ agent: target.id, runId: sub.runId, status: sub.status, costUsd: sub.costUsd, error: sub.error, children: [] }];
      route = { kind: 'delegate', agent: target.id, path: [target.id] };
      for (const s of sub.trace) trace.push({ ...s, tool: `${target.id} › ${s.tool}` });
      return await finish(sub.status, { error: sub.error, answer: sub.answer, citations: sub.citations });
    }
  } catch (err) {
    if (err instanceof ModelWithoutToolsError) return await finish('failed', { error: 'model_without_tools' });
    const message = err instanceof Error ? err.message : String(err);
    runLog.error({ err }, 'routing failed');
    return await finish('failed', { error: message });
  }
}

type Parsed =
  | { kind: 'delegate'; agent: string; question: string }
  | { kind: 'show_notes' }
  | { kind: 'propose_refresh'; ressort: string }
  | { error: string };

// Only actions that were offered, with arguments that fit; a delegate must be
// one the manifest lists (the model never picks an agent freely).
function parseRoute(call: ToolCall, specs: ToolSpec[], skill: Skill): Parsed {
  if (call.parseError) return { error: `${call.parseError}; send the arguments as a JSON object` };
  if (!specs.some((s) => s.name === call.name)) return { error: `unknown action "${call.name}"; available: ${specs.map((s) => s.name).join(', ')}` };
  const input = call.input ?? {};
  if (call.name === 'show_notes') {
    return emptyInput.safeParse(input).success ? { kind: 'show_notes' } : { error: 'show_notes takes no arguments' };
  }
  if (call.name === 'propose_refresh') {
    const r = refreshInput.safeParse(input);
    return r.success ? { kind: 'propose_refresh', ressort: r.data.ressort } : { error: 'ressort is required' };
  }
  const r = delegateInput.safeParse(input);
  if (!r.success) return { error: 'agent and question are required' };
  if (!(skill.manifest.delegates ?? []).includes(r.data.agent)) return { error: `agent "${r.data.agent}" is not allowed` };
  return { kind: 'delegate', agent: r.data.agent, question: r.data.question };
}
