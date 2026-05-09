import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getAvailableVoices } from '../lib/voice';
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
  const [voiceEnabled, setVoiceEnabled] = useState(() => localStorage.getItem('samix_voice_output') !== 'false');
  const [voiceRate, setVoiceRate] = useState(() => Number(localStorage.getItem('samix_voice_rate') || '1.0'));
  const [voiceName, setVoiceName] = useState(() => localStorage.getItem('samix_voice_name') || '');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const loadVoices = useCallback(() => {
    const v = getAvailableVoices();
    if (v.length) setVoices(v);
  }, []);

  useEffect(() => {
    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, [loadVoices]);

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

      {/* Voice */}
      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-samix-text-muted mb-3">Voice</h3>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-xs text-samix-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={() => {
                const next = !voiceEnabled;
                setVoiceEnabled(next);
                localStorage.setItem('samix_voice_output', String(next));
              }}
              className="accent-samix-accent"
            />
            Voice output enabled
          </label>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-samix-text-muted">Voice</label>
            <select
              value={voiceName}
              onChange={(e) => {
                setVoiceName(e.target.value);
                localStorage.setItem('samix_voice_name', e.target.value);
              }}
              className="bg-samix-bg border border-samix-border rounded px-2 py-1 text-xs text-samix-text-primary outline-none"
            >
              <option value="">System default</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-samix-text-muted">
              Speed: {voiceRate.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.8"
              max="1.3"
              step="0.1"
              value={voiceRate}
              onChange={(e) => {
                const r = Number(e.target.value);
                setVoiceRate(r);
                localStorage.setItem('samix_voice_rate', String(r));
              }}
              className="accent-samix-accent"
            />
          </div>
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
