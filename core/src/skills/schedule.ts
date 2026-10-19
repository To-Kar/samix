import cron from 'node-cron';

// Throws a readable error if the schedule can't work.
export function validateSchedule(s: { cron: string; timezone: string }): void {
  if (!cron.validate(s.cron)) throw new Error(`"${s.cron}" is not a valid cron expression`);
  try {
    new Intl.DateTimeFormat('en', { timeZone: s.timezone });
  } catch {
    throw new Error(`"${s.timezone}" is not a known time zone`);
  }
}
