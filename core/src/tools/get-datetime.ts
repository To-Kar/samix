import type { ToolDefinition } from '../types.js';

export const getDatetimeTool: ToolDefinition = {
  name: 'get_datetime',
  description: 'Get the current date, time, and day of week in a given timezone.',
  inputSchema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone (e.g. "America/New_York"). Defaults to system timezone.',
      },
    },
  },
  handler: async (input) => {
    const tz = (input.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Date().toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
  },
};
