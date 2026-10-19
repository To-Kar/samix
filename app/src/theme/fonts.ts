// Every family a theme may name is bundled locally (Fontsource, OFL-1.1); the
// app never fetches fonts at runtime. Fallbacks are system faces present on
// Windows and macOS.

import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/newsreader/wght-italic.css';
import '@fontsource-variable/source-serif-4/wght.css';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import '@fontsource-variable/source-sans-3/wght.css';
import '@fontsource-variable/literata/wght.css';
import '@fontsource-variable/literata/wght-italic.css';
import '@fontsource-variable/eb-garamond/wght.css';
import '@fontsource-variable/eb-garamond/wght-italic.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/400-italic.css';
import '@fontsource/atkinson-hyperlegible/700.css';
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
