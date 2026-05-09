import type { ToolDefinition } from '../types.js';
import { getDatetimeTool } from './get-datetime.js';
import { listRecentArticlesTool } from './list-recent-articles.js';
import { webSearchTool } from './web-search.js';
import { openUrlTool } from './open-url.js';
import { searchNotesTool } from './search-notes.js';
import { saveMemoryTool, recallMemoryTool } from './memory.js';

const tools = new Map<string, ToolDefinition>();

export function registerTool(t: ToolDefinition) {
  tools.set(t.name, t);
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

export function listTools(names: string[]): ToolDefinition[] {
  return names.map((n) => tools.get(n)).filter((t): t is ToolDefinition => t != null);
}

registerTool(getDatetimeTool);
registerTool(listRecentArticlesTool);
registerTool(webSearchTool);
registerTool(openUrlTool);
registerTool(searchNotesTool);
registerTool(saveMemoryTool);
registerTool(recallMemoryTool);
