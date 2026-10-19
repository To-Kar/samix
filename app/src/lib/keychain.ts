import { invoke } from '@tauri-apps/api/core';

// Account names match the env-var names the core will expect at spawn
// time (Phase 1 step 11). Keeping them identical removes the need for
// a mapping table between keychain identifiers and env vars.
//
// Newsletter delivery is the in-app newspaper UI; SMTP and Telegram
// were dropped from Phase 1 scope, so only the LLM-provider keys are
// stored in the keychain.
export const SECRET_ACCOUNTS = [
  'ANTHROPIC_API_KEY',
  'PERPLEXITY_API_KEY',
  'DEEPSEEK_API_KEY',
] as const;

export type SecretAccount = (typeof SECRET_ACCOUNTS)[number];

// The keychain only exists inside the Tauri shell. In a plain browser
// (`vite dev` without Tauri) reads say "not set" and writes fail with a clear
// message instead of an obscure TypeError.
const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const unavailable = () => Promise.reject(new Error('The keychain is only available inside the app'));

export function setSecret(account: SecretAccount, value: string): Promise<void> {
  return inTauri() ? invoke('set_secret', { account, value }) : unavailable();
}

export function hasSecret(account: SecretAccount): Promise<boolean> {
  return inTauri() ? invoke('has_secret', { account }) : Promise.resolve(false);
}

export function deleteSecret(account: SecretAccount): Promise<void> {
  return inTauri() ? invoke('delete_secret', { account }) : unavailable();
}
