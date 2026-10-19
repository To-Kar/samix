import { useEffect, useState } from 'react';
import type { ApiClient, ModelInfo } from '../lib/api';

const select =
  'rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs';

export function AgentModel({ api, slug, version, onSaved }: { api: ApiClient; slug: string; version: number; onSaved?: () => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [primary, setPrimary] = useState('');
  const [fallback, setFallback] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [list, current] = await Promise.all([api.listModels(), api.getAgentModel(slug)]);
        if (!live) return;
        setModels(list);
        setPrimary(current.primary);
        setFallback(current.fallback ?? '');
      } catch (e) {
        if (live) setMessage(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [api, slug, version]);

  const label = (m: ModelInfo) => `${m.id}${m.keyEnv ? (m.keyConfigured ? ' – Schlüssel vorhanden' : ' – kein Schlüssel') : ' – lokal'}`;
  const selected = models.find((m) => m.id === primary);

  const save = async () => {
    setMessage(null);
    try {
      await api.putAgentModel(slug, { primary, fallback: fallback || null });
      setMessage('Gespeichert – der nächste Lauf verwendet dieses Modell.');
      onSaved?.();
    } catch (e) {
      setMessage(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-3 text-xs">
        <span className="w-24 font-medium">Hauptmodell</span>
        <select className={select} value={primary} onChange={(e) => setPrimary(e.target.value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {label(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-3 text-xs">
        <span className="w-24 font-medium">Ersatzmodell</span>
        <select className={select} value={fallback} onChange={(e) => setFallback(e.target.value)}>
          <option value="">keines</option>
          {models
            .filter((m) => m.id !== primary)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {label(m)}
              </option>
            ))}
        </select>
      </label>
      {selected && !selected.keyConfigured ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Für {selected.id} fehlt der Schlüssel ({selected.keyEnv}). Bitte zuerst unter „Einrichtung“ eintragen.
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={!primary}
          className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
        >
          Modell speichern
        </button>
        {message ? <span className="text-xs text-neutral-600 dark:text-neutral-400">{message}</span> : null}
      </div>
    </div>
  );
}
