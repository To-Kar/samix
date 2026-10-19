import { useEffect, useState } from 'react';
import type { ApiClient, RunSummary } from '../lib/api';
import { explainFailure, explainPartial, runStatus } from '../lib/explain';
import { useFormat, useI18n } from '../i18n/I18nProvider';
import type { Messages } from '../i18n/messages';

function detail(t: Messages, r: RunSummary): string {
  if (r.status === 'failed') return explainFailure(t, r.error);
  if (r.status === 'partial') return explainPartial(t, r.error);
  if (r.nothingNew) return t.runs.nothingNew;
  return t.runs.result(r.articleCount, r.sourceCount);
}

export function RunHistory({ api, slug, version }: { api: ApiClient; slug: string; version: number }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const f = useFormat();

  useEffect(() => {
    setRuns(null);
    api.listRuns(slug, 20).then(setRuns, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, slug, version]);

  if (error)
    return (
      <p className="text-xs text-danger font-mono" role="alert">
        {t.status.error} {error}
      </p>
    );
  if (!runs) return <p className="text-xs text-ink-soft">{t.runs.loading}</p>;
  if (runs.length === 0) return <p className="text-xs text-ink-soft">{t.runs.none}</p>;

  const total = runs.reduce((s, r) => s + r.costUsd, 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-soft">
        {t.runs.summary(runs.length, f.usd(total))}
      </p>
      <ul className="flex flex-col divide-y divide-rule text-xs">
        {runs.map((r) => {
          const st = runStatus(t, r.status) ?? { label: r.status, cls: '' };
          return (
            <li key={r.id} className="py-2 flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className={`font-semibold ${st.cls}`}>{st.label}</span>
                <span>{f.dateTime(r.startedAt)}</span>
                <span className="text-ink-soft">{t.runs.trigger[r.trigger] ?? r.trigger}</span>
                {r.model ? <span className="text-ink-soft">{r.model}</span> : null}
                <span className="ml-auto text-ink-soft">
                  {f.usd(r.costUsd)} · {t.runs.tokens(r.tokensInput + r.tokensOutput)}
                </span>
              </div>
              <p className="text-ink-soft">{detail(t, r)}</p>
              {r.skippedSimilar?.length ? (
                <details className="text-ink-soft">
                  <summary className="cursor-pointer">
                    {t.runs.skipped(r.skippedSimilar.length)}
                  </summary>
                  <ul className="list-disc pl-5">
                    {r.skippedSimilar.map((s, i) => (
                      <li key={i}>
                        {t.app.quote(s.title)} ≈ {t.app.quote(s.similarTo)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {r.sourceNotes?.length ? (
                <ul className="text-ink-soft list-disc pl-5">
                  {r.sourceNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
