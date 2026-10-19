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

// ---- word forms ------------------------------------------------------------
//
// Used where a person (or a model) types a word and expects its other forms to
// count: "Chip" should find "Chips" and "Chiphersteller", "Modelle" should find
// "Modell". A light suffix strip for German and English, not a real stemmer.
// Short words (≤ 3 letters, like "KI") are matched exactly, so "KI" still does
// not match "Kiel" or "Skiing".

const SUFFIXES = ['ungen', 'ung', 'heit', 'keit', 'lich', 'isch', 'ing', 'ern', 'ens', 'ed', 'en', 'er', 'es', 'em', 'e', 's', 'n'];
const MIN_STEM = 3;
const MIN_PREFIX_TERM = 4;

const fold = (w: string) => w.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');

export function stem(word: string): string {
  const w = fold(word);
  for (const s of SUFFIXES) {
    if (w.length - s.length >= MIN_STEM && w.endsWith(s)) return w.slice(0, w.length - s.length);
  }
  return w;
}

export interface Tokens {
  /** Folded lowercase words as written. */
  words: string[];
  /** The same words, suffix-stripped. */
  stems: string[];
}

export function tokenize(text: string): Tokens {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).map(fold);
  return { words, stems: words.map(stem) };
}

// A matcher for one typed word against tokenized text.
export function termMatcher(term: string): (t: Tokens) => boolean {
  const word = fold(term);
  if (word.length < MIN_PREFIX_TERM) return (t) => t.words.includes(word);
  const s = stem(term);
  // Same word form, or a word that starts with it ("Chip" → "Chiphersteller").
  return (t) => t.stems.some((x) => x === s || (s.length >= MIN_PREFIX_TERM && x.startsWith(s)));
}
