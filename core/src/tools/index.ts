import { ARTICLE_TOOLS } from './articles.js';
import type { ToolCall } from '../types.js';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

export type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const registry = new Map<string, ToolDefinition<never>>(ARTICLE_TOOLS.map((t) => [t.spec.name, t]));

export function knownToolNames(): string[] {
  return [...registry.keys()];
}

// Resolves the names an agent's manifest lists. An unknown name is a
// configuration error, reported when the agent is used, not silently ignored.
export function resolveTools(names: string[]): ToolDefinition<never>[] {
  return names.map((n) => {
    const t = registry.get(n);
    if (!t) throw new Error(`unknown tool "${n}"`);
    return t;
  });
}

function errorResult(message: string): ToolResult {
  return { content: JSON.stringify({ error: message }), articleIds: [], resultCount: 0, isError: true };
}

// Runs one call from the model. Whatever goes wrong — unknown tool, bad
// arguments, an exception — comes back as an error result the model can read
// and react to; a tool can never crash a conversation.
export async function executeTool(
  call: ToolCall,
  tools: ToolDefinition<never>[],
  ctx: ToolContext
): Promise<ToolResult> {
  const tool = tools.find((t) => t.spec.name === call.name);
  if (!tool) {
    return errorResult(`unknown tool "${call.name}"; available: ${tools.map((t) => t.spec.name).join(', ')}`);
  }
  if (call.parseError) return errorResult(`${call.parseError}; send the arguments as a JSON object`);

  const parsed = tool.input.safeParse(call.input ?? {});
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return errorResult(`invalid arguments: ${why}`);
  }
  try {
    return await tool.run(parsed.data as never, ctx);
  } catch (err) {
    ctx.logger.warn({ tool: call.name, err: err instanceof Error ? err.message : String(err) }, 'tool_failed');
    return errorResult('the tool failed; try different arguments or answer from what you have');
  }
}
