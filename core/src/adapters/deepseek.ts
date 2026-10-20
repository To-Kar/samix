import { OpenAICompatAdapter } from './openai-compat.js';

// DeepSeek speaks the OpenAI chat-completions protocol, so this is plain
// fetch like the Ollama and Perplexity adapters — no provider SDK.
//
// UNVERIFIED defaults: when this adapter was written, DeepSeek's own docs
// were unreachable from the build environment, and third-party sources
// disagreed on prices and on which model name `deepseek-chat` maps to. So:
//   - the default price is the HIGHER of the figures seen ($0.27 / $1.10 per
//     million tokens). BudgetLedger and the pre-call budget gate therefore
//     over-estimate rather than under-estimate;
//   - price, model name and base URL are all overridable by environment.
// Check https://api-docs.deepseek.com/quick_start/pricing and set
// SAMIX_DEEPSEEK_PRICE_IN / SAMIX_DEEPSEEK_PRICE_OUT to the real values.
// Cache-hit discounts are not modelled (they only make the real bill lower).

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_PRICE_IN = 0.27;
const DEFAULT_PRICE_OUT = 1.1;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  }
  return n;
}

export class DeepSeekAdapter extends OpenAICompatAdapter {
  // Request/response shape follows the OpenAI function-calling format and is
  // tested against fakes. UNVERIFIED against DeepSeek's real API (docs were
  // unreachable): whether and how reliably deepseek-chat calls tools is open.
  constructor() {
    super({
      name: 'deepseek-chat',
      label: 'DeepSeek',
      baseUrl: (process.env.SAMIX_DEEPSEEK_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
      model: process.env.SAMIX_DEEPSEEK_MODEL || DEFAULT_MODEL,
      pricing: {
        inputPerMillionTokens: envNumber('SAMIX_DEEPSEEK_PRICE_IN', DEFAULT_PRICE_IN),
        outputPerMillionTokens: envNumber('SAMIX_DEEPSEEK_PRICE_OUT', DEFAULT_PRICE_OUT),
      },
      supportsTools: true,
      keyEnv: 'DEEPSEEK_API_KEY',
      keyRequired: true,
    });
  }
}
