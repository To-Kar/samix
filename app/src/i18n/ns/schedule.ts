// Schedules: how a cron rhythm is described and edited.

export const de = {
  schedule: {
    weekdays: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
    daily: (time: string) => `täglich um ${time}`,
    weekly: (weekday: number, time: string) =>
      `${['sonntags', 'montags', 'dienstags', 'mittwochs', 'donnerstags', 'freitags', 'samstags'][weekday]} um ${time}`,
    custom: (cron: string) => `Cron: ${cron}`,
    rhythm: 'Rhythmus',
    optDaily: 'Täglich',
    optWeekly: 'Wöchentlich',
    optCustom: 'Eigener Cron-Ausdruck',
    optManual: 'Nur manuell',
    weekday: 'Wochentag',
    time: 'Uhrzeit',
    cron: 'Cron-Ausdruck',
    timezone: 'Zeitzone',
    timezoneHint: 'Zeitzone (IANA, z. B. Europe/Berlin)',
  },
};

export const en: typeof de = {
  schedule: {
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    daily: (time) => `daily at ${time}`,
    weekly: (weekday, time) =>
      `${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][weekday]} at ${time}`,
    custom: (cron) => `Cron: ${cron}`,
    rhythm: 'Rhythm',
    optDaily: 'Daily',
    optWeekly: 'Weekly',
    optCustom: 'Custom cron expression',
    optManual: 'Manual only',
    weekday: 'Weekday',
    time: 'Time',
    cron: 'Cron expression',
    timezone: 'Time zone',
    timezoneHint: 'Time zone (IANA, e.g. Europe/Berlin)',
  },
};
