/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        samix: {
          bg: '#0a0a0a',
          surface: '#111111',
          border: '#1e1e1e',
          'text-primary': '#f0f0f0',
          'text-muted': '#666666',
          accent: '#7c6df0',
          'accent-hover': '#9483f5',
          success: '#22c55e',
          error: '#ef4444',
          cost: '#666666',
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
