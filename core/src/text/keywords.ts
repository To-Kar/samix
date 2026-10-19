// Whole-word, case-insensitive, Unicode-aware: "KI" matches "KI-Modell" but
// not "Skiing" or "Kiel".
export function keywordMatcher(keywords: string[]): (text: string) => boolean {
  const res = keywords.map(
    (k) => new RegExp(`(?<![\\p{L}\\p{N}])${k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu')
  );
  return (text) => res.some((re) => re.test(text));
}

// Splits a free-text query into distinct lowercase words (letters/digits,
// Unicode-aware), dropping one-letter noise. Capped so a pasted paragraph
// can't turn into a hundred regexes.
export function queryTerms(query: string, max = 8): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 2))].slice(0, max);
}
