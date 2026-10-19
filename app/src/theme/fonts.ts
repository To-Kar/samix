// CSS stacks for the families a theme may name (the faces themselves are
// loaded by fontFaces.ts). Fallbacks are system faces on Windows and macOS.

import type { FontFamily, SamixTheme, ThemeSettings } from './types';

export const FONT_STACKS: Record<FontFamily, string> = {
  Newsreader: "'Newsreader Variable', Georgia, 'Times New Roman', serif",
  'Source Serif 4': "'Source Serif 4 Variable', Georgia, serif",
  'Source Sans 3': "'Source Sans 3 Variable', 'Segoe UI', system-ui, sans-serif",
  Literata: "'Literata Variable', Georgia, serif",
  'EB Garamond': "'EB Garamond Variable', Garamond, Georgia, serif",
  'Atkinson Hyperlegible': "'Atkinson Hyperlegible', Verdana, sans-serif",
};

const SERIF: ReadonlySet<FontFamily> = new Set(['Newsreader', 'Source Serif 4', 'Literata', 'EB Garamond']);

/** Body family after the user's serif/sans/readable choice. */
export function bodyFamily(theme: SamixTheme, choice: ThemeSettings['bodyFont']): FontFamily {
  const own = theme.type.body.family;
  switch (choice) {
    case 'readable':
      return 'Atkinson Hyperlegible';
    case 'serif':
      return SERIF.has(own) ? own : theme.type.serif?.family ?? 'Source Serif 4';
    case 'sans':
      return SERIF.has(own) ? theme.type.sans?.family ?? 'Source Sans 3' : own;
    default:
      return own;
  }
}
