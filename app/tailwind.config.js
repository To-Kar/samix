/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Newsprint: warm paper and soft black ink; dark mode is dark paper.
        paper: { DEFAULT: '#f6f1e6', dark: '#15130f' },
        ink: { DEFAULT: '#1c1a16', dark: '#e8e2d4', soft: '#5d574a', 'soft-dark': '#a39b88' },
        rule: { DEFAULT: '#c9bfa8', dark: '#38342b' },
      },
      fontFamily: {
        // Bundled locally (@fontsource-variable, OFL): the CSP only allows 'self'.
        serif: ['"Source Serif 4 Variable"', 'Georgia', 'Cambria', 'serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
