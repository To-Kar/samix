import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';
import { startWakeDetector } from '../src/scheduler/index.js';
import { makeSkill } from './helpers.js';

const scheduled = (catchup: boolean) => {
  const s = makeSkill({ withSources: false, withSchema: false });
  s.manifest.schedule = { cron: '0 6 * * *', timezone: 'UTC', catchupOnStartup: catchup };
  return s;
};

describe('startWakeDetector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the catch-up check after the machine slept, but not on normal ticks', () => {
    const catchup = vi.fn(async () => undefined);
    const skill = scheduled(true);
    const stop = startWakeDetector([skill], logger, { intervalMs: 1000, gapMs: 5000, catchup });

    vi.advanceTimersByTime(3000); // regular ticks
    expect(catchup).not.toHaveBeenCalled();

    // The laptop sleeps for an hour: wall clock jumps, timers did not run.
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    vi.advanceTimersByTime(1000);
    expect(catchup).toHaveBeenCalledTimes(1);
    expect(catchup).toHaveBeenCalledWith(skill, logger);

    // Back to normal afterwards.
    vi.advanceTimersByTime(3000);
    expect(catchup).toHaveBeenCalledTimes(1);
    stop();
  });

  it('respects catchup_on_startup: false and skips non-scheduled skills', () => {
    const catchup = vi.fn(async () => undefined);
    const off = scheduled(false);
    const unscheduled = makeSkill();
    startWakeDetector([off, unscheduled], logger, { intervalMs: 1000, gapMs: 5000, catchup })
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    vi.advanceTimersByTime(1000);
    expect(catchup).not.toHaveBeenCalled();
  });

  it('stops when asked to', () => {
    const catchup = vi.fn(async () => undefined);
    const stop = startWakeDetector([scheduled(true)], logger, { intervalMs: 1000, gapMs: 5000, catchup });
    stop();
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    vi.advanceTimersByTime(5000);
    expect(catchup).not.toHaveBeenCalled();
  });
});
