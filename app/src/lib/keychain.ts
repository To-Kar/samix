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
  'OPENAI_API_KEY',
] as const;

export type SecretAccount = (typeof SECRET_ACCOUNTS)[number];

export function setSecret(account: SecretAccount, value: string): Promise<void> {
  return invoke('set_secret', { account, value });
}

export function hasSecret(account: SecretAccount): Promise<boolean> {
  return invoke('has_secret', { account });
}

export function deleteSecret(account: SecretAccount): Promise<void> {
  return invoke('delete_secret', { account });
}
