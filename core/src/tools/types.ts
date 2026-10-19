import type { z } from 'zod';
import type { Logger } from 'pino';
import type { Skill, ToolSpec } from '../types.js';

// A tool the model may call. Tools are code; which of them an agent may use
// is data (manifest `tools:`). All current tools are read-only over local data.

export interface ToolContext {
  logger: Logger;
  /** Ressort titles by agent slug, for readable results. */
  skills: Skill[];
  /** Per-question allowance, shared by all calls of one question. */
  allowance: { fullTextFetches: number };
}

export interface ToolResult {
  /** What the model sees (JSON text). */
  content: string;
  /** Articles this result surfaced: the only ones an answer may cite. */
  articleIds: string[];
  /** Number of items returned, for the step log. */
  resultCount: number;
  isError?: boolean;
}

export interface ToolDefinition<I = unknown> {
  spec: ToolSpec;
  // Input may be looser than the parsed output (defaults are filled in).
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  run(input: I, ctx: ToolContext): Promise<ToolResult>;
}
