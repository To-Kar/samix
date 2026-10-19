import { describe, expect, it } from 'vitest';
import { stem, termMatcher, tokenize } from '../src/text/keywords.js';

const hit = (term: string, text: string) => termMatcher(term)(tokenize(text));

describe('word forms', () => {
  it('strips common German and English endings, folding umlauts', () => {
    expect(stem('Chips')).toBe('chip');
    expect(stem('Modelle')).toBe('modell');
    expect(stem('Modellen')).toBe('modell');
    expect(stem('Bücher')).toBe('buch');
    expect(stem('running')).toBe('runn');
    expect(stem('Spiel')).toBe('spiel');
    // never down to a stub
    expect(stem('Des')).toBe('des');
    expect(stem('Ei')).toBe('ei');
  });

  it('matches other forms and compounds of words with 4+ letters', () => {
    expect(hit('Chip', 'KI-Chips: Rekordumsatz')).toBe(true);
    expect(hit('Chips', 'Der Chip ist schnell')).toBe(true);
    expect(hit('Chip', 'Der Chiphersteller meldet')).toBe(true);
    expect(hit('Modelle', 'Ein offenes Modell')).toBe(true);
    expect(hit('Bücher', 'Das Buch')).toBe(true);
    // a stem of fewer than 4 letters needs the exact stem, not a prefix
    expect(hit('Fans', 'Der Fan jubelt')).toBe(true);
    expect(hit('Fans', 'Die Fantasie')).toBe(false);
    expect(hit('Quantenkühlung', 'Quantenkühlung statt Lüfter')).toBe(true);
  });

  it('does not match unrelated words or the middle of a word', () => {
    expect(hit('Chip', 'Ein Schiff im Hafen')).toBe(false);
    expect(hit('Modell', 'Ein Vormodell')).toBe(false);
    expect(hit('Spiel', 'Das Beispiel')).toBe(false);
  });

  it('matches short words exactly, so KI is not Kiel, Kis or Skiing', () => {
    expect(hit('KI', 'Neue KI-Modelle')).toBe(true);
    expect(hit('KI', 'Kiel und Kis und Skiing')).toBe(false);
    expect(hit('AI', 'Die AIs')).toBe(false);
  });
});
