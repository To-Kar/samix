import { useState } from 'react';
import type { ApiClient, SourcePreview, SourceSpec } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';

// Editing of `website` sources: a site, optional keywords, a cap, and a
// preview that shows what would be fetched before anything is saved.

export interface WebsiteRow {
  url: string;
  keywords: string;
  maxItems: number;
}

export const emptyRow = (): WebsiteRow => ({ url: '', keywords: '', maxItems: 10 });

export function splitKeywords(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export function websiteConfig(row: WebsiteRow): Record<string, unknown> {
  const keywords = splitKeywords(row.keywords);
  return {
    url: row.url.trim(),
    maxItems: row.maxItems,
    ...(keywords.length ? { filter: { keywords } } : {}),
  };
}

export function websiteSources(rows: WebsiteRow[]): SourceSpec[] {
  return rows.filter((r) => r.url.trim()).map((r) => ({ type: 'website', config: websiteConfig(r) }));
}

export function rowsFromSources(list: SourceSpec[]): WebsiteRow[] {
  return list
    .filter((s) => s.type === 'website')
    .map((s) => {
      const filter = s.config['filter'] as { keywords?: string[]; topic?: string } | undefined;
      const kw = [...(filter?.keywords ?? []), ...(filter?.topic ? [filter.topic] : [])];
      return {
        url: String(s.config['url'] ?? ''),
        keywords: kw.join(', '),
        maxItems: Number(s.config['maxItems'] ?? 10),
      };
    });
}

const input =
  'rounded border border-line bg-paper-raised px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-focus';
const smallBtn =
  'rounded border border-line px-2 py-1 text-xs hover:bg-ink/5 disabled:opacity-40';

interface Props {
  api: ApiClient;
  rows: WebsiteRow[];
  onChange: (rows: WebsiteRow[]) => void;
}

export function WebsiteRowsEditor({ api, rows, onChange }: Props) {
  const { t, dateLocale } = useI18n();
  const w = t.website;
  const [previews, setPreviews] = useState<Record<number, { loading?: boolean; data?: SourcePreview; error?: string }>>({});

  const patch = (i: number, p: Partial<WebsiteRow>) => {
    onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
    setPreviews((v) => ({ ...v, [i]: {} }));
  };

  const preview = async (i: number) => {
    const row = rows[i];
    if (!row?.url.trim()) return;
    setPreviews((v) => ({ ...v, [i]: { loading: true } }));
    try {
      const data = await api.previewSource({ type: 'website', config: websiteConfig(row) });
      setPreviews((v) => ({ ...v, [i]: { data } }));
    } catch (e) {
      setPreviews((v) => ({ ...v, [i]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, i) => {
        const p = previews[i];
        return (
          <div key={i} className="flex flex-col gap-2 rounded border border-rule p-2">
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={row.url}
                onChange={(e) => patch(i, { url: e.target.value })}
                placeholder="chip.de"
                aria-label={w.site}
                className={`${input} flex-1 min-w-[10rem]`}
              />
              <input
                type="text"
                value={row.keywords}
                onChange={(e) => patch(i, { keywords: e.target.value })}
                placeholder={w.keywordsPlaceholder}
                aria-label={w.keywords}
                className={`${input} flex-1 min-w-[10rem]`}
              />
              <input
                type="number"
                min={1}
                max={50}
                value={row.maxItems}
                onChange={(e) => patch(i, { maxItems: Number(e.target.value) || 10 })}
                aria-label={w.maxItems}
                title={w.maxItems}
                className={`${input} w-16`}
              />
              <button onClick={() => void preview(i)} disabled={p?.loading || !row.url.trim()} className={smallBtn}>
                {p?.loading ? w.checking : w.preview}
              </button>
              <button
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className={`${smallBtn} text-danger`}
              >
                {w.remove}
              </button>
            </div>

            {p?.error ? (
              <div className="text-xs text-danger font-mono" role="alert">
                {t.status.error} {p.error}
              </div>
            ) : null}

            {p?.data ? (
              <div className="text-xs text-ink-soft flex flex-col gap-1">
                <p>
                  {p.data.method
                    ? w.found(w.method[p.data.method] ?? p.data.method, p.data.candidates, p.data.items.length)
                    : w.nothing}
                  {p.data.withoutDate ? w.withoutDate(p.data.withoutDate) : ''}
                  {p.data.filteredOut ? w.filteredOut(p.data.filteredOut) : ''}
                </p>
                {p.data.warnings.map((w) => (
                  <p key={w} className="text-warning">
                    ⚠ {w}
                  </p>
                ))}
                <ul className="list-disc pl-5">
                  {p.data.items.map((it) => (
                    <li key={it.url}>
                      {it.title}{' '}
                      <span className="text-ink-soft">
                        ({it.publishedAt ? new Date(it.publishedAt).toLocaleDateString(dateLocale) : w.noDate})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        );
      })}
      <button onClick={() => onChange([...rows, emptyRow()])} className={`${smallBtn} self-start`}>
        {w.add}
      </button>
    </div>
  );
}
