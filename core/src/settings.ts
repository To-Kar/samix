import { prisma } from './db/prisma.js';

// Settings the reader edits in the app. They live in the database; an
// in-memory copy keeps the budget code synchronous. Everything is optional:
// without a setting the built-in default (or the environment) applies.

const cache = new Map<string, string>();

export async function loadSettings(): Promise<void> {
  cache.clear();
  for (const row of await prisma.appSetting.findMany()) cache.set(row.key, row.value);
}

export function getSetting(key: string): string | undefined {
  return cache.get(key);
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  cache.set(key, value);
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key } });
  cache.delete(key);
}

// ---- typed accessors ----------------------------------------------------

export const GLOBAL_CAP_KEY = 'globalDailyUsdMax';

export interface PriceOverride {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
}

const priceKey = (model: string) => `price:${model}`;

export function getPriceOverride(model: string): PriceOverride | undefined {
  const raw = getSetting(priceKey(model));
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw) as PriceOverride;
    return Number.isFinite(p.inputPerMillionTokens) && Number.isFinite(p.outputPerMillionTokens) ? p : undefined;
  } catch {
    return undefined;
  }
}

export const setPriceOverride = (model: string, p: PriceOverride) => setSetting(priceKey(model), JSON.stringify(p));
export const clearPriceOverride = (model: string) => deleteSetting(priceKey(model));

// Language the agents write the articles in. Unset = the prompt decides (no
// instruction added). The app sets it, either fixed or following its own UI
// language; it applies from the next run on, past articles are not touched.
export const ARTICLE_LANGUAGE_KEY = 'articleLanguage';
export const ARTICLE_LANGUAGES = ['de', 'en'] as const;
export type ArticleLanguage = (typeof ARTICLE_LANGUAGES)[number];

export function getArticleLanguage(): ArticleLanguage | undefined {
  const v = getSetting(ARTICLE_LANGUAGE_KEY);
  return (ARTICLE_LANGUAGES as readonly string[]).includes(v ?? '') ? (v as ArticleLanguage) : undefined;
}

// ---- AI settings: simple / advanced ---------------------------------------
// Simple (default): only the built-in models and the agents' own prompts.
// Advanced: the reader's own model ("custom") and extra instructions per agent
// take effect. The local model (Ollama) is configurable in both modes. Values
// kept while simple are not applied, only remembered.

export const AI_MODES = ['simple', 'advanced'] as const;
export type AiMode = (typeof AI_MODES)[number];
export const AI_MODE_KEY = 'aiMode';

export const getAiMode = (): AiMode => (getSetting(AI_MODE_KEY) === 'advanced' ? 'advanced' : 'simple');
export const isAdvanced = (): boolean => getAiMode() === 'advanced';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3';
const OLLAMA_URL_KEY = 'ollamaUrl';
const OLLAMA_MODEL_KEY = 'ollamaModel';

/** App setting first, then the environment (dev), then the default. */
export const getOllamaUrl = (): string =>
  (getSetting(OLLAMA_URL_KEY) ?? process.env.SAMIX_OLLAMA_URL ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
export const getOllamaModel = (): string => getSetting(OLLAMA_MODEL_KEY) ?? process.env.SAMIX_OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
export const ollamaSource = (): 'app' | 'env' | 'default' =>
  getSetting(OLLAMA_URL_KEY) !== undefined || getSetting(OLLAMA_MODEL_KEY) !== undefined
    ? 'app'
    : process.env.SAMIX_OLLAMA_URL || process.env.SAMIX_OLLAMA_MODEL
      ? 'env'
      : 'default';

export async function setOllama(url: string, model: string): Promise<void> {
  await setSetting(OLLAMA_URL_KEY, url);
  await setSetting(OLLAMA_MODEL_KEY, model);
}
export async function resetOllama(): Promise<void> {
  await deleteSetting(OLLAMA_URL_KEY);
  await deleteSetting(OLLAMA_MODEL_KEY);
}

/** The reader's own model: any OpenAI-compatible chat endpoint. */
export interface CustomModel {
  baseUrl: string;
  model: string;
  /** Whether the reader says the model can call tools (needed for Fragen). */
  tools: boolean;
}
const CUSTOM_KEY = 'customModel';

export function getCustomModel(): CustomModel | undefined {
  const raw = getSetting(CUSTOM_KEY);
  if (!raw) return undefined;
  try {
    const c = JSON.parse(raw) as CustomModel;
    return typeof c.baseUrl === 'string' && typeof c.model === 'string' && c.baseUrl && c.model
      ? { baseUrl: c.baseUrl.replace(/\/+$/, ''), model: c.model, tools: c.tools === true }
      : undefined;
  } catch {
    return undefined;
  }
}
export const setCustomModel = (c: CustomModel) => setSetting(CUSTOM_KEY, JSON.stringify(c));
export const clearCustomModel = () => deleteSetting(CUSTOM_KEY);

/** Extra instructions per agent, appended to its prompt (advanced mode only). */
export const MAX_INSTRUCTIONS_CHARS = 2000;
const instructionsKey = (slug: string) => `instructions:${slug}`;
export const getInstructions = (slug: string): string | undefined => getSetting(instructionsKey(slug)) || undefined;
export const setInstructions = (slug: string, text: string) => setSetting(instructionsKey(slug), text);
export const clearInstructions = (slug: string) => deleteSetting(instructionsKey(slug));
