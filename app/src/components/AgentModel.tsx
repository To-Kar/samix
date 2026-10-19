import { useEffect, useState } from 'react';
import type { ApiClient, ModelInfo } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';

const select =
  'rounded border border-line bg-paper-raised px-2 py-1 text-xs';

export function AgentModel({ api, slug, version, onSaved }: { api: ApiClient; slug: string; version: number; onSaved?: () => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [primary, setPrimary] = useState('');
  const [fallback, setFallback] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const { t } = useI18n();
  const m_ = t.agentModel;

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

  const label = (m: ModelInfo) => `${m.id}${m.keyEnv ? (m.keyConfigured ? m_.keyPresent : m_.noKey) : m_.local}`;
  const selected = models.find((m) => m.id === primary);

  const save = async () => {
    setMessage(null);
    try {
      await api.putAgentModel(slug, { primary, fallback: fallback || null });
      setMessage(m_.saved);
      onSaved?.();
    } catch (e) {
      setMessage(m_.saveFailed(e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-3 text-xs">
        <span className="w-24 font-medium">{m_.primary}</span>
        <select className={select} value={primary} onChange={(e) => setPrimary(e.target.value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {label(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-3 text-xs">
        <span className="w-24 font-medium">{m_.fallback}</span>
        <select className={select} value={fallback} onChange={(e) => setFallback(e.target.value)}>
          <option value="">{m_.none}</option>
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
        <p className="text-xs text-warning">
          {m_.missingKey(selected.id, selected.keyEnv ?? '')}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={!primary}
          className="rounded border border-line px-3 py-1 text-xs hover:bg-ink/5 disabled:opacity-40"
        >
          {m_.save}
        </button>
        {message ? <span className="text-xs text-ink-soft">{message}</span> : null}
      </div>
    </div>
  );
}
