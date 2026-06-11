import type { ToolDefinition } from '../types.js';

export const openUrlTool: ToolDefinition = {
  name: 'open_url',
  description: 'Open a URL in the default browser.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to open.' },
    },
    required: ['url'],
  },
  handler: async (input) => {
    const { exec } = await import('node:child_process');
    const url = input.url as string;
    const cmd = process.platform === 'darwin' ? `open "${url}"` : `start "${url}"`;
    return new Promise((resolve) => {
      exec(cmd, { timeout: 5000 }, (err) => {
        resolve(err ? `Failed to open: ${err.message}` : `Opened ${url}`);
      });
    });
  },
};
