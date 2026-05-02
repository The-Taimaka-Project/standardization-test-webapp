import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pass: '#16a34a',
        partial: '#f59e0b',
        fail: '#dc2626',
      },
    },
  },
  plugins: [],
} satisfies Config;
