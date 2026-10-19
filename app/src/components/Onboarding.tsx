import { useEffect, useState } from 'react';
import type { ApiClient, ModelInfo } from '../lib/api';
import { setSecret, type SecretAccount } from '../lib/keychain';
import { restartCore } from '../lib/native';
import { setOnboarded } from '../lib/prefs';

const NEWSLETTER_SLUG = 'newsletter-ai';
const LOCAL_MODEL = 'ollama-llama3';

// What to offer, in this order, with a plain-language description.
const CHOICES: { id: string; title: string; note: string }[] = [
  { id: 'claude-haiku-4-5', title: 'Claude Haiku (Anthropic)', note: 'Braucht einen API-Schlüssel von Anthropic.' },
  { id: 'deepseek-chat', title: 'DeepSeek', note: 'Braucht einen API-Schlüssel von DeepSeek; in der Regel günstiger.' },
  { id: LOCAL_MODEL, title: 'Nur lokal (Ollama)', note: 'Kein Schlüssel und keine Kosten, aber Ollama muss auf diesem Rechner installiert sein und laufen.' },
];

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

  useEffect(() => {
    api.listModels().then(setModels, (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)));
  }, [api]);

  const available = CHOICES.filter((c) => models?.some((m) => m.id === c.id));
  const info = models?.find((m) => m.id === choice);
  const needsKey = Boolean(info?.keyEnv);

  const finish = async () => {
    if (!info) return;
    setBusy(true);
    setMessage(null);
    try {
      if (info.keyEnv) {
        if (!key.trim()) {
          setMessage('Bitte den API-Schlüssel eintragen.');
          return;
        }
        await setSecret(info.keyEnv as SecretAccount, key.trim());
        const result = await restartCore();
        if (!result.restarted) {
          setMessage(`Der Schlüssel ist gespeichert, aber der Core wurde nicht neu gestartet: ${result.reason}`);
          return;
        }
      }
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
    }
  };

  return (
    <div className="mx-auto max-w-xl py-10">
      <h2 className="font-serif font-bold text-3xl mb-2">Willkommen bei Samix</h2>
      <p className="text-ink-soft dark:text-ink-soft-dark mb-6">
        Samix sammelt Artikel aus deinen Quellen und fasst sie mit einem Sprachmodell zusammen. Welches soll es benutzen?
        Das lässt sich später in den Einstellungen ändern.
      </p>

      <div className="flex flex-col gap-3 mb-6">
        {available.map((c) => (
          <label
            key={c.id}
            className={`flex gap-3 border p-3 cursor-pointer ${choice === c.id ? 'border-ink dark:border-ink-dark' : 'border-rule dark:border-rule-dark'}`}
          >
            <input type="radio" name="model" checked={choice === c.id} onChange={() => setChoice(c.id)} />
            <span>
              <span className="font-bold block">{c.title}</span>
              <span className="text-sm text-ink-soft dark:text-ink-soft-dark">{c.note}</span>
            </span>
          </label>
        ))}
      </div>

      {needsKey ? (
        <label className="block mb-6">
          <span className="block text-sm font-bold mb-1">API-Schlüssel</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void finish()}
            placeholder="wird im Schlüsselbund des Betriebssystems gespeichert"
            className="w-full border border-rule dark:border-rule-dark bg-transparent px-3 py-2 font-mono text-sm"
            autoComplete="off"
          />
        </label>
      ) : null}

      {message ? <p className="mb-4 text-sm text-red-700 dark:text-red-400">{message}</p> : null}

      <button
        onClick={() => void finish()}
        disabled={busy || !models}
        className="border border-ink dark:border-ink-dark px-4 py-2 font-bold hover:bg-ink hover:text-paper dark:hover:bg-ink-dark dark:hover:text-paper-dark disabled:opacity-40"
      >
        {busy ? 'Einen Moment …' : 'Weiter und erste Ausgabe erstellen'}
      </button>
    </div>
  );
}
