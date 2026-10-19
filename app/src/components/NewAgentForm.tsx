import { useEffect, useState } from 'react';
import type { ApiClient } from '../lib/api';
import { ScheduleEditor, type ScheduleValue } from './ScheduleEditor';
import { WebsiteRowsEditor, emptyRow, websiteSources, type WebsiteRow } from './WebsiteRows';

interface Props {
  api: ApiClient;
  onCreated: (slug: string) => void;
  onCancel: () => void;
}

const field =
  'w-full rounded border border-line bg-paper-raised px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-focus';

export function NewAgentForm({ api, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [focus, setFocus] = useState('');
  const [rows, setRows] = useState<WebsiteRow[]>([emptyRow()]);
  const [rss, setRss] = useState('');
  // Where the Ressort looks: the open web, chosen sites, or both.
  const [where, setWhere] = useState<'search' | 'sites' | 'both'>('sites');
  const [searchKey, setSearchKey] = useState(true);
  useEffect(() => {
    api.listModels().then((m) => setSearchKey(m.some((x) => x.id === 'perplexity-sonar' && x.keyConfigured)), () => undefined);
  }, [api]);
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
  const siteSources = [...websiteSources(rows), ...(rssUrls.length ? [{ type: 'rss' as const, config: { urls: rssUrls, maxPerFeed: 20 } }] : [])];
  const searches = where !== 'sites';
  const sources = [
    ...(where === 'search' ? [] : siteSources),
    ...(searches ? [{ type: 'perplexity_search' as const, config: { useTopic: true, recencyHours: 24 } }] : []),
  ];
  const missing = [
    !title.trim() ? 'einen Namen' : null,
    !focus.trim() ? 'ein Thema („Worum soll es gehen?“)' : null,
    sources.length === 0 ? 'mindestens eine Webseite oder einen RSS-Feed (oder „im Web suchen“ wählen)' : null,
  ].filter(Boolean);
  const valid = missing.length === 0;

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
      <h3 className="font-head font-bold text-xl">Neues Ressort</h3>

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
        <span className="text-xs text-ink-soft">
          Das Sprachmodell wählt aus den abgerufenen Beiträgen die passenden aus. Stichwörter an den Quellen filtern
          vorher kostenlos.
        </span>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold mb-1">Woher sollen die Artikel kommen?</legend>
        {(
          [
            ['search', 'Allgemein im Web suchen', 'Samix sucht selbst nach dem Thema (Perplexity). Du musst keine Seite kennen.'],
            ['sites', 'Nur bestimmte Seiten', 'Nur die Webseiten und Feeds, die du unten einträgst.'],
            ['both', 'Beides', 'Deine Seiten und zusätzlich eine allgemeine Websuche.'],
          ] as const
        ).map(([id, label, note]) => (
          <label key={id} className="flex items-start gap-2 text-sm">
            <input type="radio" name="where" className="mt-1" checked={where === id} onChange={() => setWhere(id)} />
            <span>
              <span className="font-semibold">{label}</span>
              <span className="block text-xs text-ink-soft">{note}</span>
            </span>
          </label>
        ))}
        {searches ? (
          <p className="text-xs text-ink-soft">
            Jede Suche kostet extra (geschätzt etwa 0,25 Cent, abgebucht vom Tageslimit des Ressorts). Das lässt sich später unter
            „Quellen“ des Ressorts ändern.
            {!searchKey ? <span className="text-warning"> Es ist noch kein Perplexity-Schlüssel eingetragen (Einrichtung → Weitere Anbieter).</span> : null}
          </p>
        ) : null}
      </fieldset>

      {where !== 'search' ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold">Seiten und Feeds</span>
          <WebsiteRowsEditor api={api} rows={rows} onChange={setRows} />
          <textarea className={`${field} font-mono text-xs mt-2`} rows={2} value={rss} onChange={(e) => setRss(e.target.value)} placeholder="Optional: RSS-Feeds, eine URL pro Zeile" />
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold">Wann?</span>
        <ScheduleEditor value={schedule} onChange={setSchedule} />
      </div>

      <p className="text-xs text-ink-soft">
        Beim Anlegen wird nichts abgerufen und nichts bezahlt. Kosten entstehen erst, wenn du „Neue Artikel holen“
        drückst oder der Zeitplan greift. Pro Ressort gilt ein eigenes Tageslimit.
      </p>

      {error ? <p className="text-xs text-danger font-mono">{error}</p> : null}
      {!valid ? (
        <p className="text-xs text-warning" role="status">
          Zum Anlegen fehlt noch: {missing.join(', ')}.
        </p>
      ) : null}
      <div className="flex gap-3">
        <button
          onClick={() => void create()}
          disabled={!valid || busy}
          className="border border-ink px-4 py-1.5 text-sm font-bold hover:bg-ink hover:text-paper disabled:opacity-40"
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
