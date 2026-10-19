import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, Costs as CostsData } from '../lib/api';
import { useFormat, useI18n } from '../i18n/I18nProvider';

const btn = 'rounded border border-line px-2 py-1 text-xs hover:bg-ink/5 disabled:opacity-40';
const num = 'w-24 rounded border border-line bg-paper-raised px-2 py-1 text-xs text-right font-mono';

const asNumber = (v: string): number | null => {
  const n = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

// What was spent and what may be spent: the daily limit of every agent, the
// global limit, and the prices Samix calculates with.
export function Costs({ api }: { api: ApiClient }) {
  const [data, setData] = useState<CostsData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { t } = useI18n();
  const f = useFormat();
  const c = t.costs;

  const load = useCallback(async () => {
    try {
      setData(await api.getCosts());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  if (!data) return <p className="text-xs text-ink-soft">{message ?? c.loading}</p>;
  const max = Math.max(0.0001, ...data.days.map((d) => d.costUsd));

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div className="flex flex-col gap-1">
        <p>
          <strong>{c.today(f.usd(data.today))}</strong>
          {data.globalCapUsd > 0 ? c.ofCap(f.usd(data.globalCapUsd)) : c.noCap}
        </p>
        <GlobalCap data={data} onSave={(usd) => act(() => api.setGlobalCap(usd), c.capSaved)} onReset={() => act(() => api.resetGlobalCap(), c.capReset)} />
      </div>

      <div>
        <h4 className="font-semibold uppercase tracking-wider mb-1">{c.perAgent}</h4>
        <ul className="flex flex-col gap-1">
          {data.agents.map((a) => (
            <AgentLimit key={a.slug} agent={a} onSave={(usd) => act(() => api.setAgentLimit(a.slug, usd), c.limitSaved(a.title))} />
          ))}
        </ul>
        <p className="mt-1 text-ink-soft">
          {c.limitHint}
        </p>
      </div>

      <div>
        <h4 className="font-semibold uppercase tracking-wider mb-1">{c.lastDays}</h4>
        <ul className="flex flex-col gap-0.5 font-mono">
          {data.days.map((d) => (
            <li key={d.day} className="flex items-center gap-2">
              <span className="w-24">{d.day}</span>
              <span className="inline-block h-2 bg-ink" style={{ width: `${Math.round((d.costUsd / max) * 160)}px` }} />
              <span>{f.usd(d.costUsd)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="font-semibold uppercase tracking-wider mb-1">{c.prices}</h4>
        <p className="mb-2 text-ink-soft">
          {c.pricesHint}
        </p>
        <ul className="flex flex-col gap-1">
          {data.prices.map((p) => (
            <PriceRow
              key={p.model}
              info={p}
              onSave={(i, o) => act(() => api.setPrice(p.model, i, o), c.priceSaved(p.model))}
              onReset={() => act(() => api.resetPrice(p.model), c.priceReset(p.model))}
            />
          ))}
        </ul>
      </div>

      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

function GlobalCap({ data, onSave, onReset }: { data: CostsData; onSave: (usd: number) => void; onReset: () => void }) {
  const [v, setV] = useState(String(data.globalCapUsd));
  useEffect(() => setV(String(data.globalCapUsd)), [data.globalCapUsd]);
  const n = asNumber(v);
  const c = useI18n().t.costs;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2">
        {c.globalCap}
        <input className={num} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-label={c.globalCapLabel} />
      </label>
      <button className={btn} disabled={n === null || n > 1000 || n === data.globalCapUsd} onClick={() => n !== null && onSave(n)}>
        {c.save}
      </button>
      {data.globalCapSource === 'app' ? (
        <button className={btn} onClick={onReset}>
          {c.reset}
        </button>
      ) : null}
      <span className="text-ink-soft">{c.zeroNoCap}</span>
    </div>
  );
}

function AgentLimit({ agent, onSave }: { agent: CostsData['agents'][number]; onSave: (usd: number) => void }) {
  const [v, setV] = useState(String(agent.dailyUsdMax));
  useEffect(() => setV(String(agent.dailyUsdMax)), [agent.dailyUsdMax]);
  const n = asNumber(v);
  const c = useI18n().t.costs;
  const f = useFormat();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-44 font-medium">{agent.title}</span>
      <span className="w-52 text-ink-soft">
        {f.usd(agent.todayUsd)}
        {agent.todaySearchUsd > 0 ? c.ofWhichSearch(f.usd(agent.todaySearchUsd)) : ''}
      </span>
      <label className="flex items-center gap-1">
        {c.limit}
        <input className={num} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-label={c.limitLabel(agent.title)} />
      </label>
      <button className={btn} disabled={n === null || n > 1000 || n === agent.dailyUsdMax} onClick={() => n !== null && onSave(n)}>
        {c.save}
      </button>
    </li>
  );
}

function PriceRow({ info, onSave, onReset }: { info: CostsData['prices'][number]; onSave: (i: number, o: number) => void; onReset: () => void }) {
  const cur = info.custom ?? info.builtIn;
  const [i, setI] = useState(String(cur.inputPerMillionTokens));
  const [o, setO] = useState(String(cur.outputPerMillionTokens));
  useEffect(() => {
    setI(String(cur.inputPerMillionTokens));
    setO(String(cur.outputPerMillionTokens));
  }, [cur.inputPerMillionTokens, cur.outputPerMillionTokens]);
  const ni = asNumber(i);
  const no = asNumber(o);
  const changed = ni !== cur.inputPerMillionTokens || no !== cur.outputPerMillionTokens;
  const c = useI18n().t.costs;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-44 font-mono">{info.model}</span>
      <label className="flex items-center gap-1">
        {c.input}
        <input className={num} inputMode="decimal" value={i} onChange={(e) => setI(e.target.value)} aria-label={c.inputLabel(info.model)} />
      </label>
      <label className="flex items-center gap-1">
        {c.output}
        <input className={num} inputMode="decimal" value={o} onChange={(e) => setO(e.target.value)} aria-label={c.outputLabel(info.model)} />
      </label>
      <button className={btn} disabled={ni === null || no === null || !changed} onClick={() => ni !== null && no !== null && onSave(ni, no)}>
        {c.save}
      </button>
      {info.custom ? (
        <>
          <span className="text-ink">{c.setByYou}</span>
          <button className={btn} onClick={onReset}>
            {c.useBuiltIn}
          </button>
        </>
      ) : (
        <span className="text-ink-soft">{c.builtInUnchecked}</span>
      )}
    </li>
  );
}
