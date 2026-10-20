import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { AgentSummary, AiMode, AiSettings as AiSettingsData, ApiClient } from '../lib/api';
import { explainFailure } from '../lib/explain';
import { deleteSecret, hasSecret, setSecret } from '../lib/keychain';
import { Segmented } from './controls';

const card = 'border border-rule p-4 flex flex-col gap-3';
const h3 = 'font-head font-bold text-xl';
const h4 = 'text-sm font-semibold';
const btn = 'rounded border border-line px-3 py-1 text-xs hover:bg-ink/5 disabled:opacity-40';
const input = 'rounded border border-line bg-paper-raised px-2 py-1 text-xs font-mono';
const MAX_INSTRUCTIONS = 2000;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AiSettings({
  api,
  agents,
  onChanged,
  onKeyChanged,
}: {
  api: ApiClient;
  agents: AgentSummary[];
  /** The model list may have changed (own model usable or not). */
  onChanged: () => Promise<void>;
  /** The core must be restarted to see a changed key. */
  onKeyChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const a = t.ai;
  const [data, setData] = useState<AiSettingsData | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getAiSettings());
    } catch {
      // the connection banner already says so
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const update = async (next: AiSettingsData) => {
    setData(next);
    await onChanged();
  };

  if (!data) return null;
  const advanced = data.mode === 'advanced';

  return (
    <section className={card}>
      <h3 className={h3}>{a.title}</h3>
      <Segmented
        value={data.mode}
        options={[
          ['simple', a.simple],
          ['advanced', a.advanced],
        ]}
        onChange={(mode: AiMode) => void api.setAiMode(mode).then(update).catch(() => undefined)}
      />
      <p className="text-xs text-ink-soft">{advanced ? a.advancedHint : a.simpleHint}</p>

      <LocalModel api={api} data={data} onChanged={update} />

      {advanced ? (
        <>
          <CustomModel api={api} data={data} onChanged={update} onKeyChanged={onKeyChanged} />
          <Instructions api={api} agents={agents} />
        </>
      ) : null}
    </section>
  );
}

function LocalModel({ api, data, onChanged }: { api: ApiClient; data: AiSettingsData; onChanged: (d: AiSettingsData) => Promise<void> }) {
  const { t } = useI18n();
  const a = t.ai;
  const [url, setUrl] = useState(data.ollama.url);
  const [model, setModel] = useState(data.ollama.model);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (fn: () => Promise<AiSettingsData>) => {
    setMessage(null);
    try {
      const next = await fn();
      setUrl(next.ollama.url);
      setModel(next.ollama.model);
      await onChanged(next);
      setMessage(a.saved);
    } catch (e) {
      setMessage(a.saveFailed(errText(e)));
    }
  };

  const test = async () => {
    setMessage(a.testing);
    try {
      const r = await api.testModel('ollama-llama3');
      setMessage(r.ok ? a.testOk(r.ms) : a.testFailed(explainFailure(t, r.error)));
    } catch (e) {
      setMessage(a.testFailed(errText(e)));
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <h4 className={h4}>{a.local}</h4>
      <p className="text-xs text-ink-soft">{a.localHint}</p>
      <label className="flex flex-col gap-1 text-xs">
        {a.localUrl}
        <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {a.localModel}
        <input className={input} value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={() => void run(() => api.setOllama(url.trim(), model.trim()))} disabled={!url.trim() || !model.trim()}>
          {a.save}
        </button>
        <button className={btn} onClick={() => void run(() => api.resetOllama())} disabled={data.ollama.source !== 'app'}>
          {a.reset}
        </button>
        <button className={btn} onClick={() => void test()}>
          {a.test}
        </button>
        <span className="text-xs text-ink-soft">{a.localSource[data.ollama.source]}</span>
      </div>
      {message ? <p className="text-xs" role="status">{message}</p> : null}
    </div>
  );
}

function CustomModel({
  api,
  data,
  onChanged,
  onKeyChanged,
}: {
  api: ApiClient;
  data: AiSettingsData;
  onChanged: (d: AiSettingsData) => Promise<void>;
  onKeyChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const a = t.ai;
  const c = data.custom;
  const [baseUrl, setBaseUrl] = useState(c.baseUrl);
  const [model, setModel] = useState(c.model);
  const [priceIn, setPriceIn] = useState(c.inputPerMillionTokens?.toString() ?? '');
  const [priceOut, setPriceOut] = useState(c.outputPerMillionTokens?.toString() ?? '');
  const [tools, setTools] = useState(c.tools);
  const [key, setKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void hasSecret('CUSTOM_API_KEY').then(setKeySaved);
  }, []);

  const pin = Number(priceIn);
  const pout = Number(priceOut);
  const complete = baseUrl.trim() && model.trim() && priceIn.trim() !== '' && priceOut.trim() !== '' && Number.isFinite(pin) && Number.isFinite(pout);

  const save = async () => {
    setMessage(null);
    try {
      await onChanged(
        await api.setCustomModel({ baseUrl: baseUrl.trim(), model: model.trim(), tools, inputPerMillionTokens: pin, outputPerMillionTokens: pout })
      );
      setMessage(a.saved);
    } catch (e) {
      setMessage(a.saveFailed(errText(e)));
    }
  };

  const remove = async () => {
    try {
      await onChanged(await api.deleteCustomModel());
      setBaseUrl('');
      setModel('');
      setPriceIn('');
      setPriceOut('');
      setTools(false);
      setMessage(null);
    } catch (e) {
      setMessage(a.saveFailed(errText(e)));
    }
  };

  const saveKey = async () => {
    try {
      if (key.trim()) await setSecret('CUSTOM_API_KEY', key.trim());
      else await deleteSecret('CUSTOM_API_KEY');
      setKey('');
      setKeySaved(await hasSecret('CUSTOM_API_KEY'));
      await onKeyChanged();
    } catch (e) {
      setMessage(a.saveFailed(errText(e)));
    }
  };

  const test = async () => {
    setMessage(a.testing);
    try {
      const r = await api.testModel('custom');
      setMessage(r.ok ? a.testOk(r.ms) : a.testFailed(explainFailure(t, r.error)));
    } catch (e) {
      setMessage(a.testFailed(errText(e)));
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <h4 className={h4}>{a.custom}</h4>
      <p className="text-xs text-ink-soft">{a.customHint}</p>
      <label className="flex flex-col gap-1 text-xs">
        {a.customUrl}
        <input className={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {a.customName}
        <input className={input} value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs">
          {a.customIn}
          <input className={`${input} w-32`} inputMode="decimal" value={priceIn} onChange={(e) => setPriceIn(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {a.customOut}
          <input className={`${input} w-32`} inputMode="decimal" value={priceOut} onChange={(e) => setPriceOut(e.target.value)} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={tools} onChange={(e) => setTools(e.target.checked)} />
        {a.customTools}
      </label>
      <p className="text-xs text-ink-soft">{a.customDataNote}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={() => void save()} disabled={!complete}>
          {a.save}
        </button>
        <button className={btn} onClick={() => void test()} disabled={!c.usable}>
          {a.test}
        </button>
        <button className={`${btn} text-danger`} onClick={() => void remove()} disabled={!c.configured}>
          {a.customRemove}
        </button>
        <span className="text-xs text-ink-soft">{c.usable ? a.customUsable : a.customNotUsable}</span>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        {a.customKey}
        <span className="flex items-center gap-2">
          <input
            type="password"
            className={`${input} flex-1`}
            value={key}
            placeholder={keySaved ? '•••' : ''}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className={btn} onClick={() => void saveKey()} disabled={!key.trim() && !keySaved}>
            {key.trim() ? a.save : a.reset}
          </button>
        </span>
        <span className="text-ink-soft">{a.customKeyHint}</span>
      </label>
      {message ? <p className="text-xs" role="status">{message}</p> : null}
    </div>
  );
}

function Instructions({ api, agents }: { api: ApiClient; agents: AgentSummary[] }) {
  const { t } = useI18n();
  const a = t.ai;
  const list = agents.filter((x) => x.model !== 'static');
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <h4 className={h4}>{a.instructions}</h4>
      <p className="text-xs text-ink-soft">{a.instructionsHint}</p>
      {list.map((agent) => (
        <InstructionRow key={agent.slug} api={api} agent={agent} />
      ))}
    </div>
  );
}

function InstructionRow({ api, agent }: { api: ApiClient; agent: AgentSummary }) {
  const { t } = useI18n();
  const a = t.ai;
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void api.getInstructions(agent.slug).then((r) => {
      setText(r.text);
      setSaved(r.text);
    }).catch(() => undefined);
  }, [api, agent.slug]);

  const save = async () => {
    setMessage(null);
    try {
      const r = await api.setInstructions(agent.slug, text);
      setText(r.text);
      setSaved(r.text);
      setMessage(a.saved);
    } catch (e) {
      setMessage(a.saveFailed(errText(e)));
    }
  };

  return (
    <details className="text-xs" open={Boolean(saved)}>
      <summary className="cursor-pointer font-medium">{agent.title}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <textarea
          className={`${input} min-h-20 font-sans`}
          value={text}
          maxLength={MAX_INSTRUCTIONS}
          placeholder={a.instructionsPlaceholder}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <button className={btn} onClick={() => void save()} disabled={text.trim() === saved}>
            {a.save}
          </button>
          <span className="text-ink-soft">{a.instructionsCount(text.length, MAX_INSTRUCTIONS)}</span>
          {message ? <span role="status">{message}</span> : null}
        </div>
      </div>
    </details>
  );
}
