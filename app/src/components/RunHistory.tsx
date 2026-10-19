import { useEffect, useState } from 'react';
import type { ApiClient, RunSummary } from '../lib/api';
import { RUN_STATUS, explainFailure, explainPartial } from '../lib/explain';
import { formatDateTime, formatUsd } from '../lib/format';

const TRIGGER: Record<string, string> = {
  manual: 'manuell',
  schedule: 'Zeitplan',
  catchup: 'nachgeholt',
  orchestrator: 'Orchestrator',
};

function detail(r: RunSummary): string {
  if (r.status === 'failed') return explainFailure(r.error);
  if (r.status === 'partial') return explainPartial(r.error);
  if (r.nothingNew) return 'Nichts Neues: alle gefundenen Beiträge waren schon veröffentlicht.';
  return `${r.articleCount} Artikel aus ${r.sourceCount} abgerufenen Beiträgen`;
}

export function RunHistory({ api, slug, version }: { api: ApiClient; slug: string; version: number }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRuns(null);
    api.listRuns(slug, 20).then(setRuns, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, slug, version]);

  if (error) return <p className="text-xs text-danger font-mono">{error}</p>;
  if (!runs) return <p className="text-xs text-ink-soft">Lädt …</p>;
  if (runs.length === 0) return <p className="text-xs text-ink-soft">Noch keine Läufe.</p>;

  const total = runs.reduce((s, r) => s + r.costUsd, 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-soft">
        Die letzten {runs.length} Läufe · zusammen {formatUsd(total)}
      </p>
      <ul className="flex flex-col divide-y divide-rule text-xs">
        {runs.map((r) => {
          const st = RUN_STATUS[r.status] ?? { label: r.status, cls: '' };
          return (
            <li key={r.id} className="py-2 flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className={`font-semibold ${st.cls}`}>{st.label}</span>
                <span>{formatDateTime(r.startedAt)}</span>
                <span className="text-ink-soft">{TRIGGER[r.trigger] ?? r.trigger}</span>
                {r.model ? <span className="text-ink-soft">{r.model}</span> : null}
                <span className="ml-auto text-ink-soft">
                  {formatUsd(r.costUsd)} · {r.tokensInput + r.tokensOutput} Tokens
                </span>
              </div>
              <p className="text-ink-soft">{detail(r)}</p>
              {r.skippedSimilar?.length ? (
                <details className="text-ink-soft">
                  <summary className="cursor-pointer">
                    {r.skippedSimilar.length} Meldung{r.skippedSimilar.length === 1 ? '' : 'en'} übersprungen (gleiche Überschrift wie schon veröffentlicht)
                  </summary>
                  <ul className="list-disc pl-5">
                    {r.skippedSimilar.map((s, i) => (
                      <li key={i}>
                        „{s.title}“ ≈ „{s.similarTo}“
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
