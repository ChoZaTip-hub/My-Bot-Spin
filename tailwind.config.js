/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif']
      },
      boxShadow: {
        card: '0 4px 24px rgba(0, 0, 0, 0.45)'
      },
      colors: {
        surface: 'var(--surface)',
        elevated: 'var(--elevated)',
        border: 'var(--border)',
        danger: 'var(--danger)',
        accent: 'var(--accent)',
        gold: 'var(--gold)',
        profit: 'var(--profit)',
        loss: 'var(--loss)'
      }
    }
  },
  plugins: []
}
