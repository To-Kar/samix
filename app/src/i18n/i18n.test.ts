import { describe, expect, it } from 'vitest';
import { MESSAGES } from './messages';

type Tree = { [key: string]: unknown };

function shape(node: unknown, path = ''): string[] {
  if (Array.isArray(node)) return [`${path}[${node.length}]`];
  if (node && typeof node === 'object') return Object.keys(node as Tree).sort().flatMap((k) => shape((node as Tree)[k], `${path}.${k}`));
  return [`${path}:${typeof node}`];
}

describe('messages', () => {
  it('German and English have exactly the same keys, kinds and list lengths', () => {
    expect(shape(MESSAGES.en)).toEqual(shape(MESSAGES.de));
  });

  it('English contains no German umlauts or ß (left-over untranslated text)', () => {
    const strings: string[] = [];
    const walk = (n: unknown) => {
      if (typeof n === 'string') strings.push(n);
      else if (typeof n === 'function') {
        const f = n as (...a: unknown[]) => unknown;
        // Parameters are numbers, strings or string lists; try the shapes in turn.
        for (const args of [[1, 'x', 'y', 'z'], [['x', 'y']], ['x', true, 'y']]) {
          try {
            strings.push(String(f(...args)));
            break;
          } catch {
            /* next shape */
          }
        }
      }
      else if (n && typeof n === 'object') Object.values(n).forEach(walk);
    };
    walk(MESSAGES.en);
    expect(strings.filter((s) => /[äöüÄÖÜß]/.test(s))).toEqual([]);
  });
});
