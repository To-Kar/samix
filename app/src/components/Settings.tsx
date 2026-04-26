import { useEffect, useState } from 'react';
import {
  SECRET_ACCOUNTS,
  type SecretAccount,
  setSecret,
  hasSecret,
  deleteSecret,
} from '../lib/keychain';
import { isAutostartEnabled, setAutostart } from '../lib/autostart';

interface FieldSpec {
  account: SecretAccount;
  label: string;
  sensitive: boolean;
}

const GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: 'LLM providers',
    fields: [
      { account: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', sensitive: true },
      { account: 'PERPLEXITY_API_KEY', label: 'Perplexity API key', sensitive: true },
    ],
  },
];

export function Settings() {
  const [configured, setConfigured] = useState<Record<SecretAccount, boolean>>(
    () => Object.fromEntries(SECRET_ACCOUNTS.map((a) => [a, false])) as Record<SecretAccount, boolean>
  );
  const [savedFlash, setSavedFlash] = useState<SecretAccount | null>(null);
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  async function refreshAll() {
    const entries = await Promise.all(
      SECRET_ACCOUNTS.map(async (a) => [a, await hasSecret(a)] as const)
    );
    setConfigured(Object.fromEntries(entries) as Record<SecretAccount, boolean>);
  }

  useEffect(() => {
    void refreshAll();
    isAutostartEnabled()
      .then(setAutostartEnabled)
      .catch((e: unknown) =>
        setAutostartError(e instanceof Error ? e.message : String(e))
      );
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
        Stored in the OS keychain under service <code>samix</code>. Values never leave
        Rust — the UI only sees whether a key is configured. Restart the app to load
        new keys into the core.
      </div>
      {GROUPS.map((group) => (
        <section key={group.title} className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {group.title}
          </h3>
          <div className="flex flex-col gap-2">
            {group.fields.map((f) => (
              <SecretRow
                key={f.account}
                field={f}
                configured={configured[f.account]}
                flash={savedFlash === f.account}
                onSaved={async () => {
                  setSavedFlash(f.account);
                  await refreshAll();
                  setTimeout(() => setSavedFlash(null), 1500);
                }}
                onDeleted={() => void refreshAll()}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Startup
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autostartEnabled ?? false}
              disabled={autostartEnabled === null}
              onChange={(e) => {
                const enabled = e.target.checked;
                setAutostartEnabled(enabled);
                setAutostartError(null);
                setAutostart(enabled).catch((err: unknown) => {
                  setAutostartEnabled(!enabled);
                  setAutostartError(err instanceof Error ? err.message : String(err));
                });
              }}
              className="rounded border-neutral-300 dark:border-neutral-700"
            />
            <span className="text-neutral-700 dark:text-neutral-300">Launch at startup</span>
          </label>
          {autostartEnabled === null && !autostartError ? (
            <span className="text-neutral-400">loading…</span>
          ) : null}
        </div>
        {autostartError ? (
          <div className="text-xs text-red-600 dark:text-red-400 font-mono">{autostartError}</div>
        ) : null}
      </section>
    </div>
  );
}

interface SecretRowProps {
  field: FieldSpec;
  configured: boolean;
  flash: boolean;
  onSaved: () => void | Promise<void>;
  onDeleted: () => void;
}

function SecretRow({ field, configured, flash, onSaved, onDeleted }: SecretRowProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await setSecret(field.account, value);
      setValue('');
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteSecret(field.account);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-neutral-700 dark:text-neutral-300 w-40 shrink-0">
          {field.label}
        </span>
        <span
          className={
            configured
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-neutral-400'
          }
        >
          {configured ? (flash ? 'saved ✓' : 'configured') : 'not set'}
        </span>
        <span className="font-mono text-[10px] text-neutral-400 ml-auto">
          {field.account}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type={field.sensitive ? 'password' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={configured ? '••• (enter new to replace)' : 'value'}
          disabled={busy}
          className="flex-1 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-neutral-500 disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSave();
          }}
        />
        <button
          onClick={() => void handleSave()}
          disabled={busy || !value}
          className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
        >
          Save
        </button>
        {configured ? (
          <button
            onClick={() => void handleDelete()}
            disabled={busy}
            className="rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40"
          >
            Remove
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="text-xs text-red-600 dark:text-red-400 font-mono">{error}</div>
      ) : null}
    </div>
  );
}
