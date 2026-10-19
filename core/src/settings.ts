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
