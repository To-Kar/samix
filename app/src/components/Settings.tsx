import { useCallback, useEffect, useState } from 'react';
import type { AgentSummary, ApiClient, ModelInfo, ModelTestResult } from '../lib/api';
import { explainFailure } from '../lib/explain';
import { formatUsd } from '../lib/format';
import { autostart, isInstalledApp, restartCore, revealLogFile } from '../lib/native';
import { LEAD_PARAGRAPH_OPTIONS, getLeadParagraphs, setLeadParagraphs } from '../lib/prefs';
import { type SecretAccount, deleteSecret, hasSecret, setSecret } from '../lib/keychain';
import { AgentModel } from './AgentModel';
import { Notes } from './Notes';
import { Projects } from './Projects';

// "Einrichtung": everything that has to be set up once, in the order it is
// needed: providers (keys, tested), the model agents use, the data they may
// read, and app behaviour.

interface Provider {
  account: SecretAccount;
  name: string;
  /** Model used to test the key. */
  testModel: string;
  note: string;
}

const PROVIDERS: Provider[] = [
  { account: 'ANTHROPIC_API_KEY', name: 'Anthropic (Claude)', testModel: 'claude-haiku-4-5', note: 'Für Claude Haiku und Sonnet.' },
  { account: 'DEEPSEEK_API_KEY', name: 'DeepSeek', testModel: 'deepseek-chat', note: 'In der Regel günstiger.' },
];
const OPTIONAL: Provider[] = [
  { account: 'PERPLEXITY_API_KEY', name: 'Perplexity', testModel: 'perplexity-sonar', note: 'Nur für die (noch ruhende) Perplexity-Quelle.' },
];

const card = 'border border-rule dark:border-rule-dark p-4 flex flex-col gap-3';
const h3 = 'font-serif font-bold text-xl';
const btn = 'rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40';
const select = 'rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs';

export function Settings({ api }: { api: ApiClient }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [restartNote, setRestartNote] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([api.listModels(), api.listAgents()]);
      setModels(m);
      setAgents(a);
    } catch {
      // the connection banner already says so
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A changed key reaches the core only through its environment, so the core
  // is restarted. The installed app does that itself; `tauri dev` cannot.
  const applyKeyChange = useCallback(async () => {
    setRestartNote('Der Core wird neu gestartet …');
    const result = await restartCore();
    if (!result.restarted) {
      setRestartNote(`Gespeichert, aber der Core wurde nicht neu gestartet: ${result.reason}. Beende die App und starte sie neu.`);
      return;
    }
    setRestartNote('Schlüsseländerung ist aktiv.');
    // the core needs a moment to come back
    for (let i = 0; i < 8; i++) {
      try {
        setModels(await api.listModels());
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    await reload();
    setVersion((v) => v + 1);
  }, [api, reload]);

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <section className={card}>
        <h3 className={h3}>1 · Anbieter und Schlüssel</h3>
        <p className="text-xs text-ink-soft dark:text-ink-soft-dark">
          Der Schlüssel liegt im Schlüsselbund deines Betriebssystems (Dienst „samix“) und wird in der App nie angezeigt. Mit
          „Testen“ schickt Samix eine winzige Anfrage (Bruchteile eines Cents) und sagt dir, ob der Schlüssel funktioniert.
        </p>
        {PROVIDERS.map((p) => (
          <ProviderRow key={p.account} api={api} provider={p} models={models} onChanged={applyKeyChange} />
        ))}
        <details className="text-xs">
          <summary className="cursor-pointer uppercase tracking-wider">Weitere Anbieter</summary>
          <div className="mt-2 flex flex-col gap-3">
            {OPTIONAL.map((p) => (
              <ProviderRow key={p.account} api={api} provider={p} models={models} onChanged={applyKeyChange} />
            ))}
          </div>
        </details>
        {restartNote ? <p className="text-xs border border-rule dark:border-rule-dark px-3 py-2">{restartNote}</p> : null}
      </section>

      <DefaultModel api={api} models={models} agents={agents} version={version} onChanged={reload} />

      <section className={card}>
        <h3 className={h3}>3 · Daten, die Agenten lesen dürfen</h3>
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider">Projektordner</h4>
          <Projects api={api} />
        </div>
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider">Notizen</h4>
          <Notes api={api} />
        </div>
      </section>

      <LeadLength />
      <AppSection />
    </div>
  );
}

function ProviderRow({
  api,
  provider,
  models,
  onChanged,
}: {
  api: ApiClient;
  provider: Provider;
  models: ModelInfo[];
  onChanged: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<ModelTestResult | 'running' | null>(null);

  const refresh = useCallback(async () => setSaved(await hasSecret(provider.account)), [provider.account]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The core's view: does a model of this provider have its key?
  const active = models.some((m) => m.keyEnv === provider.account && m.keyConfigured);

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    setTest(null);
    try {
      await setSecret(provider.account, value.trim());
      setValue('');
      await refresh();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    setTest(null);
    try {
      await deleteSecret(provider.account);
      await refresh();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setTest('running');
    try {
      setTest(await api.testModel(provider.testModel));
    } catch (e) {
      setTest({ ok: false, error: e instanceof Error ? e.message : String(e), costUsd: 0, ms: 0, booked: false });
    }
  };

  const status = active ? 'Aktiv' : saved ? 'Gespeichert – wird nach einem Neustart der App aktiv' : 'Kein Schlüssel';
  const statusCls = active ? 'text-emerald-700 dark:text-emerald-400' : saved ? 'text-amber-700 dark:text-amber-400' : 'text-ink-soft dark:text-ink-soft-dark';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="font-semibold">{provider.name}</span>
        <span className={`text-xs ${statusCls}`}>{status}</span>
        <span className="text-xs text-ink-soft dark:text-ink-soft-dark">{provider.note}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={saved ? '••• (neuen Schlüssel eingeben, um ihn zu ersetzen)' : 'API-Schlüssel einfügen'}
          disabled={busy}
          className="flex-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs font-mono disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <button className={btn} onClick={() => void save()} disabled={busy || !value.trim()}>
          Speichern
        </button>
        <button className={btn} onClick={() => void runTest()} disabled={!active || test === 'running'} title={active ? undefined : 'Erst speichern; der Schlüssel muss aktiv sein'}>
          {test === 'running' ? 'Testet …' : 'Testen'}
        </button>
        {saved ? (
          <button className={`${btn} text-red-700 dark:text-red-400`} onClick={() => void remove()} disabled={busy}>
            Entfernen
          </button>
        ) : null}
      </div>
      {test && test !== 'running' ? (
        <p className={`text-xs ${test.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`} role="status">
          {test.ok
            ? `Funktioniert (${test.ms} ms, ${formatUsd(test.costUsd)}).`
            : test.error === 'key_missing'
              ? 'Der Core kennt den Schlüssel noch nicht. Starte die App neu.'
              : `Fehlgeschlagen: ${explainFailure(test.error)}`}
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-700 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

// IDs that are offered as the general model. Perplexity is a search model for one source.
const NOT_GENERAL = new Set(['perplexity-sonar', 'claude-sonnet-4-6']);

function DefaultModel({
  api,
  models,
  agents,
  version,
  onChanged,
}: {
  api: ApiClient;
  models: ModelInfo[];
  agents: AgentSummary[];
  version: number;
  onChanged: () => Promise<void>;
}) {
  const usable = models.filter((m) => !NOT_GENERAL.has(m.id) && m.keyConfigured);
  const [choice, setChoice] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = choice || usable[0]?.id || '';

  const apply = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.useModel(selected, true);
      const names = (l: { title: string }[]) => l.map((x) => x.title).join(', ');
      setMessage(
        `${r.changed.length ? `Umgestellt auf ${selected}: ${names(r.changed)}.` : 'Alle Agenten nutzen es schon.'}${
          r.skipped?.length ? ` Nicht umgestellt (brauchen Tool-Aufrufe, die dieses Modell nicht kann): ${names(r.skipped)}.` : ''
        }`
      );
      await onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-rule dark:border-rule-dark p-4 flex flex-col gap-3">
      <h3 className="font-serif font-bold text-xl">2 · Modell für alle Agenten</h3>
      {usable.length === 0 ? (
        <p className="text-xs text-ink-soft dark:text-ink-soft-dark">Trage zuerst oben einen Schlüssel ein (oder installiere Ollama für ein lokales Modell).</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select className={select} value={selected} onChange={(e) => setChoice(e.target.value)}>
            {usable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.keyEnv ? '' : ' (lokal, ohne Tool-Aufrufe)'}
              </option>
            ))}
          </select>
          <button className={btn} onClick={() => void apply()} disabled={busy || !selected}>
            Für alle Agenten übernehmen
          </button>
        </div>
      )}
      {message ? <p className="text-xs" role="status">{message}</p> : null}
      <ul className="text-xs flex flex-col gap-0.5">
        {agents
          .filter((a) => a.model !== 'static')
          .map((a) => (
            <li key={a.slug} className="flex gap-2">
              <span className="w-48">{a.title}</span>
              <span className="font-mono text-ink-soft dark:text-ink-soft-dark">{a.model ?? '–'}</span>
            </li>
          ))}
      </ul>
      <details className="text-xs">
        <summary className="cursor-pointer uppercase tracking-wider">Erweitert: Modell je Agent</summary>
        <div className="mt-2 flex flex-col gap-4">
          {agents
            .filter((a) => a.model !== 'static')
            .map((a) => (
              <div key={a.slug} className="flex flex-col gap-1">
                <p className="font-semibold">{a.title}</p>
                <AgentModel api={api} slug={a.slug} version={version} onSaved={() => void onChanged()} />
              </div>
            ))}
        </div>
      </details>
    </section>
  );
}

function AppSection() {
  const installed = isInstalledApp();
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void autostart.isEnabled().then(setAuto, () => undefined);
  }, []);

  if (!installed) return null;

  return (
    <section className={card}>
      <h3 className={h3}>App</h3>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            const on = e.target.checked;
            setError(null);
            autostart.set(on).then(
              () => setAuto(on),
              (err: unknown) => setError(err instanceof Error ? err.message : String(err))
            );
          }}
        />
        Samix beim Anmelden starten (in der Menüleiste, Fenster versteckt)
      </label>
      <button
        onClick={() => revealLogFile().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
        className={`${btn} self-start`}
      >
        Logdatei anzeigen
      </button>
      {error ? <div className="text-xs text-red-600 dark:text-red-400 font-mono">{error}</div> : null}
    </section>
  );
}

function LeadLength() {
  const [value, setValue] = useState(getLeadParagraphs);
  return (
    <section className={card}>
      <h3 className={h3}>Zeitung</h3>
      <label className="flex items-center gap-3 text-xs">
        <span className="font-medium">Titelgeschichte: Länge des Auszugs (Absätze)</span>
        <select
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            setValue(n);
            setLeadParagraphs(n);
          }}
          className={select}
        >
          {LEAD_PARAGRAPH_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
