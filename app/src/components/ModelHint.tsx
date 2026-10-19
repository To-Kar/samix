import { useCallback, useEffect, useState } from 'react';
import type { AgentSummary, ApiClient, ModelInfo } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';

// Models that make sense as a general default, in the order they are offered.
const OFFER = ['claude-haiku-4-5', 'deepseek-chat'];

// Shown when an agent is set to a model whose API key is missing while a key
// for another model exists: the common first-run state after entering a key
// for a different provider than the shipped default.
export function ModelHint({ api, refreshKey }: { api: ApiClient; refreshKey: unknown }) {
  const [state, setState] = useState<{ stuck: AgentSummary[]; options: string[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { t } = useI18n();

  const load = useCallback(async () => {
    try {
      const [agents, models] = await Promise.all([api.listAgents(), api.listModels()]);
      const keyed = new Map<string, ModelInfo>(models.map((m) => [m.id, m]));
      const stuck = agents.filter((a) => {
        const m = a.model ? keyed.get(a.model) : undefined;
        return a.enabled && m?.keyEnv && !m.keyConfigured;
      });
      const options = OFFER.filter((id) => keyed.get(id)?.keyConfigured && keyed.get(id)?.keyEnv);
      setState({ stuck, options });
    } catch {
      setState(null);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!state || state.stuck.length === 0 || state.options.length === 0) return message ? <p className="text-xs" role="status">{message}</p> : null;

  const apply = async (id: string) => {
    try {
      const r = await api.useModel(id);
      setMessage(t.modelHint.switched(r.changed.length, id, r.changed.map((c) => c.title).join(', ')));
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const names = state.stuck.map((a) => `${a.title} (${a.model})`).join(', ');
  return (
    <div className="border border-warning bg-warning-paper p-3 text-sm flex flex-wrap items-center gap-3" role="status">
      <span>
        {t.modelHint.missingKey(names, state.options.join(t.modelHint.and))}
      </span>
      {state.options.map((id) => (
        <button key={id} className="uppercase tracking-wider text-xs font-bold hover:underline" onClick={() => void apply(id)}>
          {t.modelHint.switchTo(id)}
        </button>
      ))}
    </div>
  );
}
