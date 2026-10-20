import { ArticleLanguageSetting } from './ArticleLanguage';
import { useCallback, useEffect, useState } from 'react';
import type { AgentSummary, ApiClient, ModelInfo, ModelTestResult } from '../lib/api';
import { explainFailure } from '../lib/explain';
import { autostart, isInstalledApp, restartCore, revealLogFile } from '../lib/native';
import { LEAD_PARAGRAPH_OPTIONS, getLeadParagraphs, setLeadParagraphs } from '../lib/prefs';
import { type SecretAccount, deleteSecret, hasSecret, setSecret } from '../lib/keychain';
import { AgentModel } from './AgentModel';
import { Costs } from './Costs';
import { Notes } from './Notes';
import { useFormat, useI18n } from '../i18n/I18nProvider';
import { LOCALE_NAMES, LOCALES } from '../i18n/messages';
import { Segmented } from './controls';
import { Appearance } from './Appearance';
import { ThemeShare } from './ThemeShare';
import { Projects } from './Projects';

// "Einrichtung": everything that has to be set up once, in the order it is
// needed: providers (keys, tested), the model agents use, the data they may
// read, and app behaviour.

interface Provider {
  account: SecretAccount;
  name: string;
  /** Model used to test the key. */
  testModel: string;
}

const PROVIDERS: Provider[] = [
  { account: 'ANTHROPIC_API_KEY', name: 'Anthropic (Claude)', testModel: 'claude-haiku-4-5' },
  { account: 'DEEPSEEK_API_KEY', name: 'DeepSeek', testModel: 'deepseek-chat' },
];
const OPTIONAL: Provider[] = [
  { account: 'PERPLEXITY_API_KEY', name: 'Perplexity', testModel: 'perplexity-sonar' },
];

const card = 'border border-rule p-4 flex flex-col gap-3';
const h3 = 'font-head font-bold text-xl';
const btn = 'rounded border border-line px-3 py-1 text-xs hover:bg-ink/5 disabled:opacity-40';
const select = 'rounded border border-line bg-paper-raised px-2 py-1 text-xs';

export function Settings({ api }: { api: ApiClient }) {
  const { t, locale, setLocale } = useI18n();
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
    setRestartNote(t.settings.restarting);
    const result = await restartCore();
    if (!result.restarted) {
      setRestartNote(t.settings.notRestarted(result.reason));
      return;
    }
    setRestartNote(t.settings.keyActive);
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
  }, [api, reload, t]);

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <section className={card}>
        <h3 className={h3}>{t.settings.providers}</h3>
        <p className="text-xs text-ink-soft">
          {t.settings.providersHint}
        </p>
        {PROVIDERS.map((p) => (
          <ProviderRow key={p.account} api={api} provider={p} models={models} onChanged={applyKeyChange} />
        ))}
        <details className="text-xs">
          <summary className="cursor-pointer uppercase tracking-wider">{t.settings.moreProviders}</summary>
          <div className="mt-2 flex flex-col gap-3">
            {OPTIONAL.map((p) => (
              <ProviderRow key={p.account} api={api} provider={p} models={models} onChanged={applyKeyChange} />
            ))}
          </div>
        </details>
        {restartNote ? <p className="text-xs border border-rule px-3 py-2">{restartNote}</p> : null}
      </section>

      <DefaultModel api={api} models={models} agents={agents} version={version} onChanged={reload} />

      <section className={card}>
        <h3 className={h3}>{t.settings.costs}</h3>
        <Costs api={api} />
      </section>

      <section className={card}>
        <h3 className={h3}>{t.settings.data}</h3>
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider">{t.settings.projects}</h4>
          <Projects api={api} />
        </div>
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider">{t.settings.notes}</h4>
          <Notes api={api} />
        </div>
      </section>

      <LeadLength />

      <section className={card}>
        <h3 className={h3}>{t.app.language}</h3>
        <Segmented value={locale} options={LOCALES.map((l) => [l, LOCALE_NAMES[l]])} onChange={setLocale} />
        <p className="text-xs text-ink-soft">{t.app.languageHint}</p>
        <ArticleLanguageSetting />
      </section>

      <section className={card}>
        <h3 className={h3}>{t.app.appearance}</h3>
        <Appearance />
      </section>

      <section className={card}>
        <h3 className={h3}>{t.share.title}</h3>
        <ThemeShare />
      </section>

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
  const { t } = useI18n();
  const f = useFormat();
  const s = t.settings;

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

  const status = active ? s.statusActive : saved ? s.statusSaved : s.statusNone;
  const statusCls = active ? 'text-ink' : saved ? 'text-warning' : 'text-ink-soft';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="font-semibold">{provider.name}</span>
        <span className={`text-xs ${statusCls}`}>{status}</span>
        <span className="text-xs text-ink-soft">{s.providerNote[provider.account]}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={saved ? s.replaceKey : s.pasteKey}
          disabled={busy}
          className="flex-1 rounded border border-line bg-paper-raised px-2 py-1 text-xs font-mono disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <button className={btn} onClick={() => void save()} disabled={busy || !value.trim()}>
          {s.save}
        </button>
        <button className={btn} onClick={() => void runTest()} disabled={!active || test === 'running'} title={active ? undefined : s.testNeedsActive}>
          {test === 'running' ? s.testing : s.test}
        </button>
        {saved ? (
          <button className={`${btn} text-danger`} onClick={() => void remove()} disabled={busy}>
            {s.remove}
          </button>
        ) : null}
      </div>
      {test && test !== 'running' ? (
        <p className={`text-xs ${test.ok ? 'text-ink' : 'text-danger'}`} role="status">
          {test.ok
            ? s.testOk(test.ms, f.usd(test.costUsd))
            : test.error === 'key_missing'
              ? s.testKeyUnknown
              : s.testFailed(explainFailure(t, test.error))}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {t.status.error} {error}
        </p>
      ) : null}
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
  const { t } = useI18n();
  const s = t.settings;
  const selected = choice || usable[0]?.id || '';

  const apply = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.useModel(selected, true);
      const names = (l: { title: string }[]) => l.map((x) => x.title).join(', ');
      setMessage(
        (r.changed.length ? s.switchedTo(selected, names(r.changed)) : s.allUseIt) +
          (r.skipped?.length ? s.skipped(names(r.skipped)) : '')
      );
      await onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-rule p-4 flex flex-col gap-3">
      <h3 className="font-head font-bold text-xl">{s.model}</h3>
      {usable.length === 0 ? (
        <p className="text-xs text-ink-soft">{s.needKeyFirst}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select className={select} value={selected} onChange={(e) => setChoice(e.target.value)}>
            {usable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.keyEnv ? '' : s.localNoTools}
              </option>
            ))}
          </select>
          <button className={btn} onClick={() => void apply()} disabled={busy || !selected}>
            {s.applyAll}
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
              <span className="font-mono text-ink-soft">{a.model ?? '–'}</span>
              {a.version ? <span className="text-ink-soft">{s.promptVersion(a.version)}</span> : null}
            </li>
          ))}
      </ul>
      <details className="text-xs">
        <summary className="cursor-pointer uppercase tracking-wider">{s.perAgent}</summary>
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
  const { t } = useI18n();

  useEffect(() => {
    void autostart.isEnabled().then(setAuto, () => undefined);
  }, []);

  if (!installed) return null;

  return (
    <section className={card}>
      <h3 className={h3}>{t.settings.app}</h3>
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
        {t.settings.autostart}
      </label>
      <button
        onClick={() => revealLogFile().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
        className={`${btn} self-start`}
      >
        {t.settings.showLog}
      </button>
      {error ? (
        <div className="text-xs text-danger font-mono" role="alert">
          {t.status.error} {error}
        </div>
      ) : null}
    </section>
  );
}

function LeadLength() {
  const [value, setValue] = useState(getLeadParagraphs);
  const { t } = useI18n();
  return (
    <section className={card}>
      <h3 className={h3}>{t.settings.newspaper}</h3>
      <label className="flex items-center gap-3 text-xs">
        <span className="font-medium">{t.settings.leadLength}</span>
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
