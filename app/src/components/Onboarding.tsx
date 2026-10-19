import { useEffect, useState } from 'react';
import type { ApiClient, ModelInfo } from '../lib/api';
import { setSecret, type SecretAccount } from '../lib/keychain';
import { restartCore } from '../lib/native';
import { setOnboarded } from '../lib/prefs';
import { explainFailure } from '../lib/explain';
import { useI18n } from '../i18n/I18nProvider';

const NEWSLETTER_SLUG = 'newsletter-ai';
const LOCAL_MODEL = 'ollama-llama3';

// What to offer, in this order (descriptions in i18n/ns/onboarding.ts).
const CHOICES = ['claude-haiku-4-5', 'deepseek-chat', LOCAL_MODEL];

interface Props {
  api: ApiClient;
  /** Called when setup is finished; `run` asks the front page to create the first edition. */
  onDone: (opts: { run: boolean }) => void;
}

export function Onboarding({ api, onDone }: Props) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [choice, setChoice] = useState('claude-haiku-4-5');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const { t } = useI18n();
  const o = t.onboarding;

  useEffect(() => {
    api.listModels().then(setModels, (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)));
  }, [api]);

  const available = CHOICES.filter((id) => models?.some((m) => m.id === id));
  const info = models?.find((m) => m.id === choice);
  const needsKey = Boolean(info?.keyEnv);

  const finish = async () => {
    if (!info) return;
    setBusy(true);
    setMessage(null);
    try {
      if (info.keyEnv) {
        if (!key.trim()) {
          setMessage(o.enterKey);
          return;
        }
        setStep(o.savingKey);
        await setSecret(info.keyEnv as SecretAccount, key.trim());
        setStep(o.restarting);
        const result = await restartCore();
        if (!result.restarted) {
          setMessage(o.notRestarted(result.reason));
          return;
        }
        // Prove the key works before anything is paid for or configured.
        setStep(o.testingKey);
        let test = null;
        for (let i = 0; i < 8 && !test; i++) {
          try {
            test = await api.testModel(choice);
          } catch {
            await new Promise((r) => setTimeout(r, 600)); // the core is still coming back
          }
        }
        if (!test || !test.ok) {
          setMessage(o.keyFails(test ? explainFailure(t, test.error) : o.coreSilent));
          return;
        }
      }
      setStep(o.settingModel);
      await api.useModel(choice, true);
      await api.putAgentModel(NEWSLETTER_SLUG, {
        primary: choice,
        // A local model as safety net when a hosted one is chosen.
        fallback: choice === LOCAL_MODEL ? null : models?.some((m) => m.id === LOCAL_MODEL) ? LOCAL_MODEL : null,
      });
      setOnboarded();
      onDone({ run: true });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  return (
    <div className="mx-auto max-w-xl py-10">
      <h2 className="font-head font-bold text-3xl mb-2">{o.welcome}</h2>
      <p className="text-ink-soft mb-6">{o.intro}</p>

      <div className="flex flex-col gap-3 mb-6">
        {available.map((id) => (
          <label
            key={id}
            className={`flex gap-3 border p-3 cursor-pointer ${choice === id ? 'border-ink' : 'border-rule'}`}
          >
            <input type="radio" name="model" checked={choice === id} onChange={() => setChoice(id)} />
            <span>
              <span className="font-bold block">{o.choices[id]?.title ?? id}</span>
              <span className="text-sm text-ink-soft">{o.choices[id]?.note}</span>
            </span>
          </label>
        ))}
      </div>

      {needsKey ? (
        <label className="block mb-6">
          <span className="block text-sm font-bold mb-1">{o.apiKey}</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void finish()}
            placeholder={o.keyPlaceholder}
            className="w-full border border-rule bg-transparent px-3 py-2 font-mono text-sm"
            autoComplete="off"
          />
        </label>
      ) : null}

      <ol className="mb-4 text-xs text-ink-soft flex gap-4">
        {o.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {step ? <p className="mb-4 text-sm" role="status">{step}</p> : null}
      {message ? (
        <p className="mb-4 text-sm text-danger" role="alert">
          {t.status.error} {message}
        </p>
      ) : null}

      <button
        onClick={() => void finish()}
        disabled={busy || !models}
        className="border border-ink px-4 py-2 font-bold hover:bg-ink hover:text-paper disabled:opacity-40"
      >
        {busy ? o.wait : o.go}
      </button>
    </div>
  );
}
