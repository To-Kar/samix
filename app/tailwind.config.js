/** @type {import('tailwindcss').Config} */

// Colours and fonts come from the active theme (src/theme/apply.ts writes the
// CSS variables on <html>). Colours are RGB triplets so opacity modifiers
// (`bg-ink/5`) keep working. Components use these tokens only — no `dark:`
// variants: every theme carries its own light and dark palette.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const COLOR_TOKENS = [
  'paper', 'paper-raised', 'ink', 'ink-soft', 'rule', 'line', 'accent', 'on-accent',
  'mark', 'focus', 'danger', 'danger-paper', 'warning', 'warning-paper',
];

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: Object.fromEntries(COLOR_TOKENS.map((n) => [n, token(n)])),
      fontFamily: {
        // Bundled locally (Fontsource, OFL): the CSP only allows 'self'.
        head: ['var(--font-head)'],
        body: ['var(--font-body)'],
        ui: ['var(--font-ui)'],
      },
      borderRadius: { theme: 'var(--radius)' },
      maxWidth: { measure: 'var(--measure)' },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
