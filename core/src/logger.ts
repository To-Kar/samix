import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { destination, pino } from 'pino';
import { rotateLog } from './log-rotate.js';

const level = process.env.SAMIX_LOG_LEVEL ?? 'info';
const logFile = process.env.SAMIX_LOG_FILE;

// Installed app: JSON lines into a file (nobody sees stdout), rotated at
// startup. Written synchronously: the core exits right after logging a startup
// failure, and an async destination would lose exactly that line. Dev: pretty
// output on the terminal. Tests (level 'silent'): neither.
function build() {
  if (logFile && level !== 'silent') {
    mkdirSync(dirname(logFile), { recursive: true });
    rotateLog(logFile);
    return pino({ level }, destination({ dest: logFile, sync: true, mkdir: true }));
  }
  return pino({
    level,
    transport:
      process.env.NODE_ENV === 'production' || level === 'silent'
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
  });
}

export const logger = build();
