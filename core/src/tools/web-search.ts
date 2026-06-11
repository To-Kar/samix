import type { ToolDefinition } from '../types.js';
import { PerplexitySearchFetcher } from '../sources/perplexity.js';

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for current information using Perplexity. Returns search results with snippets and URLs.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query.',
      },
    },
    required: ['query'],
  },
  handler: async (input, ctx) => {
    const fetcher = new PerplexitySearchFetcher();
    const items = await fetcher.fetch(
      { queries: [input.query as string], recencyHours: 24 },
      { runId: ctx.runId, logger: ctx.logger, input: { message: input.query } }
    );
    if (items.length === 0) return 'No results found.';
    return items
      .map((item) => `- ${item.title}: ${item.snippet ?? ''} (${item.url})`)
      .join('\n');
  },
};
