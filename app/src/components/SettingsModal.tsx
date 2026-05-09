import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  SECRET_ACCOUNTS,
  type SecretAccount,
  setSecret,
  hasSecret,
  deleteSecret,
} from '../lib/keychain';

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const [configured, setConfigured] = useState<Record<SecretAccount, boolean>>(
    () => Object.fromEntries(SECRET_ACCOUNTS.map((a) => [a, false])) as Record<SecretAccount, boolean>
  );
  const [autostart, setAutostart] = useState(false);

  async function refreshAll() {
    const entries = await Promise.all(
      SECRET_ACCOUNTS.map(async (a) => [a, await hasSecret(a)] as const)
    );
    setConfigured(Object.fromEntries(entries) as Record<SecretAccount, boolean>);
  }

  useEffect(() => {
    void refreshAll();
    invoke<boolean>('get_autostart').then(setAutostart).catch(() => {});
  }, []);

  const toggleAutostart = async () => {
    try {
      await invoke('set_autostart', { enabled: !autostart });
      setAutostart(!autostart);
    } catch { /* ignore */ }
  };

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-samix-text-primary">Settings</h2>
        <button onClick={onClose} className="text-xs text-samix-text-muted hover:text-samix-text-primary">
          &times;
        </button>
      </div>

      {/* API Keys */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-samix-text-muted mb-3">API Keys</h3>
        <div className="flex flex-col gap-3">
          {SECRET_ACCOUNTS.map((account) => (
            <SecretRow
              key={account}
              account={account}
              configured={configured[account]}
              onChanged={() => void refreshAll()}
            />
          ))}
        </div>
      </section>

      {/* Preferences */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-samix-text-muted mb-3">Preferences</h3>
        <label className="flex items-center gap-2 text-xs text-samix-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={autostart}
            onChange={() => void toggleAutostart()}
            className="accent-samix-accent"
          />
          Launch Samix on login
        </label>
        <div className="mt-2 text-[11px] text-samix-text-muted">
          Global hotkey: <kbd className="border border-samix-border rounded px-1 py-0.5 text-samix-text-primary">Cmd+Shift+J</kbd>
        </div>
      </section>
    </div>
  );
}

function SecretRow({ account, configured, onChanged }: { account: SecretAccount; configured: boolean; onChanged: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (!value) return;
    setBusy(true);
    try {
      await setSecret(account, value);
      setValue('');
      onChanged();
    } catch { /* ignore */ }
    setBusy(false);
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteSecret(account);
      onChanged();
    } catch { /* ignore */ }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-samix-text-muted font-mono">{account}</span>
        <span className={configured ? 'text-samix-success' : 'text-samix-text-muted'}>
          {configured ? 'configured' : 'not set'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={configured ? 'enter new to replace' : 'paste key'}
          disabled={busy}
          className="flex-1 bg-samix-bg border border-samix-border rounded px-2 py-1 text-xs font-mono text-samix-text-primary placeholder:text-samix-text-muted outline-none focus:border-samix-accent disabled:opacity-50"
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
        />
        <button
          onClick={() => void handleSave()}
          disabled={busy || !value}
          className="text-xs text-samix-text-muted hover:text-samix-text-primary border border-samix-border rounded px-2 py-1 disabled:opacity-30"
        >
          Save
        </button>
        {configured && (
          <button
            onClick={() => void handleDelete()}
            disabled={busy}
            className="text-xs text-samix-error border border-samix-border rounded px-2 py-1 disabled:opacity-30"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
