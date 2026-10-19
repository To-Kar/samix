import { useEffect, useState } from 'react';
import type { ApiClient } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';
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
  const { t } = useI18n();
  const n = t.newAgent;
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
    !title.trim() ? n.missingName : null,
    !focus.trim() ? n.missingTopic : null,
    sources.length === 0 ? n.missingSource : null,
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
      <h3 className="font-head font-bold text-xl">{n.title}</h3>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{n.name}</span>
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={n.namePlaceholder} maxLength={60} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{n.topic}</span>
        <textarea
          className={field}
          rows={2}
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          maxLength={400}
          placeholder={n.topicPlaceholder}
        />
        <span className="text-xs text-ink-soft">
          {n.topicHint}
        </span>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold mb-1">{n.where}</legend>
        {(
          [
            ['search', n.whereSearch, n.whereSearchNote],
            ['sites', n.whereSites, n.whereSitesNote],
            ['both', n.whereBoth, n.whereBothNote],
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
            {n.searchCost}
            {!searchKey ? <span className="text-warning">{n.noSearchKey}</span> : null}
          </p>
        ) : null}
      </fieldset>

      {where !== 'search' ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold">{n.sites}</span>
          <WebsiteRowsEditor api={api} rows={rows} onChange={setRows} />
          <textarea className={`${field} font-mono text-xs mt-2`} rows={2} value={rss} onChange={(e) => setRss(e.target.value)} placeholder={n.rssPlaceholder} />
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{n.when}</span>
        <ScheduleEditor value={schedule} onChange={setSchedule} />
      </div>

      <p className="text-xs text-ink-soft">
        {n.costHint}
      </p>

      {error ? (
        <p className="text-xs text-danger font-mono" role="alert">
          {t.status.error} {error}
        </p>
      ) : null}
      {!valid ? (
        <p className="text-xs text-warning" role="status">
          {n.missing(missing.join(', '))}
        </p>
      ) : null}
      <div className="flex gap-3">
        <button
          onClick={() => void create()}
          disabled={!valid || busy}
          className="border border-ink px-4 py-1.5 text-sm font-bold hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          {busy ? n.creating : n.create}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-sm hover:underline">
          {n.cancel}
        </button>
      </div>
    </div>
  );
}
