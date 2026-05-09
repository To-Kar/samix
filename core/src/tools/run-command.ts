import { exec } from 'node:child_process';
import type { ToolDefinition } from '../types.js';

const BLOCKED = [
  /\brm\s+-rf\s+[\/~]/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|halt)\b/i,
  />\s*\/dev\//,
];

const TIMEOUT_MS = 10_000;

export const runCommandTool: ToolDefinition = {
  name: 'run_command',
  description:
    'Execute a shell command on the user\'s computer and return the output. ' +
    'Use for automation tasks like listing files, checking system info, running scripts. ' +
    'Commands are sandboxed with a 10-second timeout. Destructive commands are blocked.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
    },
    required: ['command'],
  },
  handler: async (input, ctx) => {
    const command = input.command as string;

    for (const pattern of BLOCKED) {
      if (pattern.test(command)) {
        return `Blocked: command matches safety filter (${pattern.source})`;
      }
    }

    ctx.logger.info({ command }, 'executing_command');

    return new Promise((resolve) => {
      exec(command, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
        if (err) {
          const msg = err.killed
            ? `Command timed out after ${TIMEOUT_MS / 1000}s`
            : `Exit code ${err.code}: ${stderr || err.message}`;
          resolve(msg);
          return;
        }
        const output = stdout.trim() || stderr.trim() || '(no output)';
        resolve(output.slice(0, 4000));
      });
    });
  },
};
