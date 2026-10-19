import type { NormalizedRequest } from '../types.js';

// Defence in depth: the conversation runner already refuses models without
// tool support, but an adapter must never silently drop tools it was handed.
export function assertNoTools(adapterName: string, req: NormalizedRequest): void {
  if (req.tools?.length || req.messages.some((m) => m.role === 'tool')) {
    throw new Error(`${adapterName} does not support tool use`);
  }
}
