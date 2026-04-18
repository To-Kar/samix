import type { ModelAdapter, ModelId } from '../types.js';
import { StaticAdapter } from './static.js';
import { ClaudeAdapter } from './claude.js';

export type AdapterFactory = () => ModelAdapter;

const registry = new Map<ModelId, AdapterFactory>();

registry.set('static', () => new StaticAdapter());
registry.set('claude-haiku-4-5', () => new ClaudeAdapter('claude-haiku-4-5'));
registry.set('claude-sonnet-4-5', () => new ClaudeAdapter('claude-sonnet-4-5'));

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
