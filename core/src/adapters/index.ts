import type { Logger } from 'pino';
import type {
  ModelAdapter,
  ModelId,
  ModelPreference,
  NormalizedRequest,
  NormalizedResponse,
} from '../types.js';
import { StaticAdapter } from './static.js';
import { ClaudeAdapter } from './claude.js';
import { OpenAIAdapter } from './openai.js';
import { PerplexityAdapter } from './perplexity.js';
import { OllamaAdapter } from './ollama.js';

export type AdapterFactory = () => ModelAdapter;

const registry = new Map<ModelId, AdapterFactory>();

registry.set('static', () => new StaticAdapter());
registry.set('claude-haiku-4-5', () => new ClaudeAdapter('claude-haiku-4-5'));
registry.set('claude-sonnet-4-6', () => new ClaudeAdapter('claude-sonnet-4-6'));
registry.set('gpt-4o-mini', () => new OpenAIAdapter('gpt-4o-mini'));
registry.set('gpt-4o', () => new OpenAIAdapter('gpt-4o'));
registry.set('perplexity-sonar', () => new PerplexityAdapter());
registry.set('ollama-llama3', () => new OllamaAdapter());

export function resolveAdapter(modelId: ModelId): ModelAdapter {
  const factory = registry.get(modelId);
  if (!factory) {
    throw new Error(`No adapter registered for model "${modelId}"`);
  }
  return factory();
}

export function knownModelIds(): ModelId[] {
  return Array.from(registry.keys());
}

export interface FallbackGenerateResult {
  response: NormalizedResponse;
  adapter: ModelAdapter;
  primaryError?: Error;
}

// Try the primary adapter; on any error, log and try the declared fallback.
// If both fail — or there is no fallback — rethrow the original primary error
// so the runner can persist a meaningful failure message.
export async function generateWithFallback(
  pref: ModelPreference,
  req: NormalizedRequest,
  logger: Logger
): Promise<FallbackGenerateResult> {
  const primary = resolveAdapter(pref.primary);
  try {
    const response = await primary.generate(req);
    return { response, adapter: primary };
  } catch (err) {
    const primaryError = err instanceof Error ? err : new Error(String(err));
    logger.warn(
      { primary: pref.primary, fallback: pref.fallback, err: primaryError.message },
      'adapter_primary_failed'
    );
    if (!pref.fallback) throw primaryError;
    const fallback = resolveAdapter(pref.fallback);
    try {
      const response = await fallback.generate(req);
      return { response, adapter: fallback, primaryError };
    } catch (fallbackErr) {
      const fbError = fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));
      logger.error(
        { primary: pref.primary, fallback: pref.fallback, err: fbError.message },
        'adapter_fallback_failed'
      );
      throw primaryError;
    }
  }
}
