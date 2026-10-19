import { useState } from 'react';
import type { ApiClient } from '../lib/api';
import { ScheduleEditor, type ScheduleValue } from './ScheduleEditor';
import { WebsiteRowsEditor, emptyRow, websiteSources, type WebsiteRow } from './WebsiteRows';

interface Props {
  api: ApiClient;
  onCreated: (slug: string) => void;
  onCancel: () => void;
}

const field =
  'w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400';

export function NewAgentForm({ api, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [focus, setFocus] = useState('');
  const [rows, setRows] = useState<WebsiteRow[]>([emptyRow()]);
  const [rss, setRss] = useState('');
  const [schedule, setSchedule] = useState<ScheduleValue | null>({
    cron: '0 6 * * *',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rssUrls = rss
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const sources = [...websiteSources(rows), ...(rssUrls.length ? [{ type: 'rss' as const, config: { urls: rssUrls, maxPerFeed: 20 } }] : [])];
  const valid = title.trim() && focus.trim() && sources.length > 0;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createAgent({ title: title.trim(), focus: focus.trim(), sources, ...(schedule ? { schedule } : {}) });
      onCreated(res.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h3 className="font-serif font-bold text-xl">Neues Ressort</h3>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">Name</span>
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Chip · KI" maxLength={60} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">Worum soll es gehen?</span>
        <textarea
          className={field}
          rows={2}
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          maxLength={400}
          placeholder="z. B. Künstliche Intelligenz, Sprachmodelle und ihre Anwendung im Alltag"
        />
        <span className="text-xs text-neutral-500">
          Das Sprachmodell wählt aus den abgerufenen Beiträgen die passenden aus. Stichwörter an den Quellen filtern
          vorher kostenlos.
        </span>
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold">Quellen</span>
        <WebsiteRowsEditor api={api} rows={rows} onChange={setRows} />
        <textarea className={`${field} font-mono text-xs mt-2`} rows={2} value={rss} onChange={(e) => setRss(e.target.value)} placeholder="Optional: RSS-Feeds, eine URL pro Zeile" />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold">Wann?</span>
        <ScheduleEditor value={schedule} onChange={setSchedule} />
      </div>

      <p className="text-xs text-neutral-500">
        Beim Anlegen wird nichts abgerufen und nichts bezahlt. Kosten entstehen erst, wenn du „Neue Ausgabe erstellen“
        drückst oder der Zeitplan greift. Pro Ressort gilt ein eigenes Tageslimit.
      </p>

      {error ? <p className="text-xs text-red-600 dark:text-red-400 font-mono">{error}</p> : null}
      <div className="flex gap-3">
        <button
          onClick={() => void create()}
          disabled={!valid || busy}
          className="border border-ink dark:border-ink-dark px-4 py-1.5 text-sm font-bold hover:bg-ink hover:text-paper dark:hover:bg-ink-dark dark:hover:text-paper-dark disabled:opacity-40"
        >
          {busy ? 'Legt an …' : 'Ressort anlegen'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-sm hover:underline">
          Abbrechen
        </button>
      </div>
    </div>
  );
}
