import { WEEKDAYS, buildCron, parseCron, type Recurrence } from '../lib/cron';

// Picks "daily at 06:00" / "weekly on Monday at 07:30" / a custom cron /
// "manual only". Controlled: the parent decides when to save.

export interface ScheduleValue {
  cron: string;
  timezone: string;
}

interface Props {
  value: ScheduleValue | null;
  onChange: (value: ScheduleValue | null) => void;
}

const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const two = (n: number) => String(n).padStart(2, '0');
const field =
  'rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs';

type Mode = 'manual' | Recurrence['kind'];

export function ScheduleEditor({ value, onChange }: Props) {
  const timezone = value?.timezone ?? browserZone();
  const rec: Recurrence | null = value ? parseCron(value.cron) : null;
  const mode: Mode = rec ? rec.kind : 'manual';

  const set = (r: Recurrence, tz = timezone) => onChange({ cron: buildCron(r), timezone: tz });

  const switchMode = (m: Mode) => {
    if (m === 'manual') return onChange(null);
    const base = rec && rec.kind !== 'custom' ? rec : { hour: 6, minute: 0, weekday: 1 };
    if (m === 'daily') set({ kind: 'daily', hour: base.hour, minute: base.minute });
    else if (m === 'weekly') set({ kind: 'weekly', hour: base.hour, minute: base.minute, weekday: 'weekday' in base ? base.weekday : 1 });
    else set({ kind: 'custom', cron: value?.cron ?? '0 6 * * *' });
  };

  const time = rec && rec.kind !== 'custom' ? `${two(rec.hour)}:${two(rec.minute)}` : '06:00';
  const setTime = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    if (!rec || rec.kind === 'custom' || h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return;
    set({ ...rec, hour: h, minute: m });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <select className={field} value={mode} onChange={(e) => switchMode(e.target.value as Mode)} aria-label="Rhythmus">
        <option value="daily">Täglich</option>
        <option value="weekly">Wöchentlich</option>
        <option value="custom">Eigener Cron-Ausdruck</option>
        <option value="manual">Nur manuell</option>
      </select>

      {rec && rec.kind === 'weekly' ? (
        <select className={field} value={rec.weekday} onChange={(e) => set({ ...rec, weekday: Number(e.target.value) })} aria-label="Wochentag">
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      ) : null}

      {rec && rec.kind !== 'custom' ? (
        <input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Uhrzeit" />
      ) : null}

      {rec && rec.kind === 'custom' ? (
        <input
          type="text"
          className={`${field} font-mono w-40`}
          value={rec.cron}
          onChange={(e) => set({ kind: 'custom', cron: e.target.value })}
          aria-label="Cron-Ausdruck"
        />
      ) : null}

      {value ? (
        <input
          type="text"
          className={`${field} font-mono w-44`}
          value={value.timezone}
          onChange={(e) => onChange({ ...value, timezone: e.target.value })}
          aria-label="Zeitzone"
          title="Zeitzone (IANA, z. B. Europe/Berlin)"
        />
      ) : null}
    </div>
  );
}
