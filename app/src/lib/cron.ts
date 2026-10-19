// Turns the few schedules people actually want into cron expressions and
// back, so the UI doesn't make anyone write cron. Anything else stays "custom".

import type { Messages } from '../i18n/messages';

export type Recurrence =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'custom'; cron: string };

const DAILY = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;
const WEEKLY = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/;

const inRange = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;

export function parseCron(cron: string): Recurrence {
  const c = cron.trim().replace(/\s+/g, ' ');
  const d = DAILY.exec(c);
  if (d && inRange(+d[1]!, 59) && inRange(+d[2]!, 23)) return { kind: 'daily', minute: +d[1]!, hour: +d[2]! };
  const w = WEEKLY.exec(c);
  if (w && inRange(+w[1]!, 59) && inRange(+w[2]!, 23)) {
    return { kind: 'weekly', minute: +w[1]!, hour: +w[2]!, weekday: +w[3]! };
  }
  return { kind: 'custom', cron: c };
}

export function buildCron(r: Recurrence): string {
  switch (r.kind) {
    case 'daily':
      return `${r.minute} ${r.hour} * * *`;
    case 'weekly':
      return `${r.minute} ${r.hour} * * ${r.weekday}`;
    case 'custom':
      return r.cron;
  }
}

const two = (n: number) => String(n).padStart(2, '0');

export function describeCron(t: Messages, cron: string): string {
  const r = parseCron(cron);
  switch (r.kind) {
    case 'daily':
      return t.schedule.daily(`${two(r.hour)}:${two(r.minute)}`);
    case 'weekly':
      return t.schedule.weekly(r.weekday, `${two(r.hour)}:${two(r.minute)}`);
    case 'custom':
      return t.schedule.custom(r.cron);
  }
}
