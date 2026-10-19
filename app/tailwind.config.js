/** @type {import('tailwindcss').Config} */

// Colours and fonts come from the active theme (src/theme/apply.ts writes the
// CSS variables). Colours are RGB triplets so opacity modifiers still work.
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
