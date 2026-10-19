import { pino } from 'pino';

const level = process.env.SAMIX_LOG_LEVEL ?? 'info';

export const logger = pino({
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
