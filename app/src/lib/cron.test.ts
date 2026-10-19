import { describe, expect, it } from 'vitest';
import { buildCron, describeCron, parseCron } from './cron';
import { MESSAGES } from '../i18n/messages';

describe('cron helpers', () => {
  it('recognises daily and weekly schedules', () => {
    expect(parseCron('0 6 * * *')).toEqual({ kind: 'daily', hour: 6, minute: 0 });
    expect(parseCron('  30  7 * * 1 ')).toEqual({ kind: 'weekly', hour: 7, minute: 30, weekday: 1 });
  });

  it('keeps everything else as custom, including out-of-range values', () => {
    for (const c of ['*/15 * * * *', '0 6 1 * *', '0 6 * * 1-5', '61 6 * * *', '0 24 * * *', '0 6 * * 7']) {
      expect(parseCron(c)).toEqual({ kind: 'custom', cron: c });
    }
  });

  it('round-trips', () => {
    for (const c of ['0 6 * * *', '5 23 * * *', '45 8 * * 0', '0 12 * * 6', '*/15 * * * *']) {
      expect(buildCron(parseCron(c))).toBe(c);
    }
  });

  it('describes in German', () => {
    expect(describeCron(MESSAGES.de, '0 6 * * *')).toBe('täglich um 06:00');
    expect(describeCron(MESSAGES.de, '15 8 * * 1')).toBe('montags um 08:15');
    expect(describeCron(MESSAGES.de, '*/15 * * * *')).toBe('Cron: */15 * * * *');
    expect(describeCron(MESSAGES.en, '15 8 * * 1')).toBe('Mondays at 08:15');
  });
});
