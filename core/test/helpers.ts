import { resolve } from 'node:path';
import { vi } from 'vitest';
import { CORE_DIR } from '../src/db/paths.js';
import { prisma } from '../src/db/prisma.js';
import { registerAdapter } from '../src/adapters/index.js';
import { registerFetcher } from '../src/sources/index.js';
import type {
  ModelAdapter,
  NormalizedRequest,
  ToolCall,
  ModelId,
  NormalizedResponse,
  Skill,
  SourceItem,
} from '../src/types.js';

// Real newsletter-ai schema, so tests exercise the shipped validation rules.
const NEWSLETTER_DIR = resolve(CORE_DIR, '../agents/newsletter-ai');

let counter = 0;

export function makeSkill(opts: {
  withSources?: boolean;
  withSchema?: boolean;
  primary?: ModelId;
  fallback?: ModelId;
  dailyUsdMax?: number;
  minItems?: number;
} = {}): Skill {
  const id = `test-agent-${++counter}`;
  const { withSources = true, withSchema = true } = opts;
  return {
    id,
    title: id,
    description: 'test agent',
    enabled: true,
    type: 'proactive',
    version: '1.0',
    skillMdPath: resolve(NEWSLETTER_DIR, 'SKILL.md'),
    systemPrompt: 'test prompt',
    manifest: {
      id,
      type: 'proactive',
      version: '1.0',
      model: {
        primary: opts.primary ?? 'claude-haiku-4-5',
        fallback: opts.fallback,
      },
      budget: {
        dailyUsdMax: opts.dailyUsdMax ?? 0.5,
        tokensPerRunMax: 4000,
        haltOnBudgetExceeded: true,
      },
      sources: withSources ? [{ type: 'rss', config: {} }] : undefined,
      output: {
        format: 'newsletter_items',
        schemaPath: withSchema ? './schema.json' : undefined,
        minItems: opts.minItems ?? 5,
      },
    },
  };
}

export async function seedAgent(skill: Skill): Promise<string> {
  const row = await prisma.agent.upsert({
    where: { slug: skill.id },
    create: { slug: skill.id, type: skill.type, skillPath: skill.skillMdPath },
    update: {},
  });
  return row.id;
}

export function fakeAdapter(
  name: ModelId,
  generate: ModelAdapter['generate'],
  pricing = { inputPerMillionTokens: 1, outputPerMillionTokens: 5 }
): ModelAdapter & { generate: ReturnType<typeof vi.fn> } {
  return {
    name,
    supportsTools: false,
    supportsSearch: false,
    pricing,
    generate: vi.fn(generate),
  };
}

export function respond(content: string, tokens = { in: 1000, out: 500 }): NormalizedResponse {
  return {
    content,
    toolCalls: [],
    citations: [],
    usage: { inputTokens: tokens.in, outputTokens: tokens.out },
    stopReason: 'end_turn',
  };
}

export function useAdapter(adapter: ModelAdapter): void {
  registerAdapter(adapter.name, () => adapter);
}

export function useRssItems(items: SourceItem[]): void {
  registerFetcher('rss', () => ({ type: 'rss', fetch: async () => items }));
}

// `null` = sources that carry no publication date.
export function sourceItems(
  count: number,
  publishedAt: Date | null = new Date('2026-10-18T08:00:00Z')
): SourceItem[] {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.com/post-${i}`,
    title: `Source title ${i}`,
    sourceName: 'Example Feed',
    sourceType: 'rss' as const,
    publishedAt: publishedAt ?? undefined,
  }));
}

// Model output in the shape newsletter-ai's schema expects.
export function llmOutput(
  urls: string[],
  extra: { publishedAt?: string } = {}
): string {
  return JSON.stringify({
    items: urls.map((sourceUrl, i) => ({
      title: `Rewritten ${i}`,
      summary: `Summary ${i}`,
      sourceUrl,
      topic: 'research',
      ...extra,
    })),
  });
}

// ---- scripted tool-using models (conversation and orchestrator tests) ------

export type Step = (req: NormalizedRequest, callNo: number) => NormalizedResponse | Promise<NormalizedResponse>;

export const toolCall = (name: string, input: unknown, id = `c${Math.random()}`): ToolCall => ({ id, name, input });
export const calling = (...calls: ToolCall[]): NormalizedResponse => ({ ...respond(''), toolCalls: calls, stopReason: 'tool_use' });
export const finalAnswer = (answer: string, sources: string[]) => respond(JSON.stringify({ answer, sources }));

// A model that plays back `steps` in order (the last one repeats).
export function scripted(steps: Step[], opts: { tools?: boolean; name?: ModelId } = {}) {
  const requests: NormalizedRequest[] = [];
  let n = 0;
  const adapter = fakeAdapter(opts.name ?? 'claude-haiku-4-5', async (req) => {
    // Snapshot: the loop keeps appending to the same messages array.
    requests.push({ ...req, messages: [...req.messages] });
    const step = steps[Math.min(n, steps.length - 1)]!;
    return step(req, n++);
  });
  adapter.supportsTools = opts.tools ?? true;
  return { adapter, requests };
}

// A reactive agent that answers from articles, with all four article tools.
export function reactiveSkill(over: { dailyUsdMax?: number; fallback?: ModelId; primary?: ModelId } = {}): Skill {
  const s = makeSkill({ withSources: false, withSchema: false, dailyUsdMax: over.dailyUsdMax, fallback: over.fallback, primary: over.primary });
  s.type = 'reactive';
  s.manifest.type = 'reactive';
  s.manifest.sources = undefined;
  s.manifest.tools = ['list_ressorts', 'search_articles', 'get_article', 'fetch_full_text'];
  s.manifest.output = { format: 'answer' };
  return s;
}
