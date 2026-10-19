import { describe, expect, it } from 'vitest';
import { splitAnswer } from './answer';

describe('splitAnswer', () => {
  it('turns known [n] markers into references and keeps the rest as text', () => {
    expect(splitAnswer('A [1] und B [2].', new Set([1, 2]))).toEqual([
      { text: 'A ' },
      { ref: 1 },
      { text: ' und B ' },
      { ref: 2 },
      { text: '.' },
    ]);
  });

  it('leaves markers without a source as plain text', () => {
    expect(splitAnswer('Liste [3] fertig', new Set([1]))).toEqual([{ text: 'Liste [3] fertig' }]);
  });

  it('handles text with no markers and adjacent markers', () => {
    expect(splitAnswer('nur Text', new Set([1]))).toEqual([{ text: 'nur Text' }]);
    expect(splitAnswer('[1][2]', new Set([1, 2]))).toEqual([{ ref: 1 }, { ref: 2 }]);
  });
});
