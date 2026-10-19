import { useEffect, useState } from 'react';
import {
  SECRET_ACCOUNTS,
  type SecretAccount,
  setSecret,
  hasSecret,
  deleteSecret,
} from '../lib/keychain';

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

  async function refreshAll() {
    const entries = await Promise.all(
      SECRET_ACCOUNTS.map(async (a) => [a, await hasSecret(a)] as const)
    );
    setConfigured(Object.fromEntries(entries) as Record<SecretAccount, boolean>);
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="samix-note">
        Stored in the OS keychain under service <code>samix</code>. Values never leave
        Rust — the UI only sees whether a key is configured. Restart the app to load
        new keys into the core (auto-spawn lands with Phase 1 step 11).
      </div>
      {GROUPS.map((group) => (
        <section key={group.title} className="flex flex-col gap-3">
          <h3 className="samix-label">
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
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium w-40 shrink-0">
          {field.label}
        </span>
        <span
          className={
            configured ? 'text-ink' : 'text-ink-soft'
          }
        >
          {configured ? (flash ? 'saved ✓' : 'configured') : 'not set'}
        </span>
        <span className="font-mono text-sm text-ink-soft ml-auto">
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
          className="flex-1 samix-input font-mono"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSave();
          }}
        />
        <button
          onClick={() => void handleSave()}
          disabled={busy || !value}
          className="samix-button"
        >
          Save
        </button>
        {configured ? (
          <button
            onClick={() => void handleDelete()}
            disabled={busy}
            className="samix-button text-danger"
          >
            Remove
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="text-sm text-danger font-mono">{error}</div>
      ) : null}
    </div>
  );
}
