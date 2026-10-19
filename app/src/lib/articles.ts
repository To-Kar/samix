import type { Article } from './api';

/** Calendar day key (local time), e.g. "2026-10-19". */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Articles grouped by the day Samix collected them, newest day first (input is newest-first). */
export function groupByDay(articles: Article[]): [string, Article[]][] {
  const map = new Map<string, Article[]>();
  for (const a of articles) {
    const key = dayKey(a.createdAt);
    const list = map.get(key);
    if (list) list.push(a);
    else map.set(key, [a]);
  }
  return Array.from(map.entries());
}

/** Distinct topics in first-seen order. */
export function ressortsOf(articles: Article[]): string[] {
  return Array.from(new Set(articles.map((a) => a.topic).filter((t): t is string => !!t)));
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function sourceLabel(a: Article): string | null {
  return a.sourceName ?? (a.sourceUrl ? hostnameOf(a.sourceUrl) : null);
}

export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
