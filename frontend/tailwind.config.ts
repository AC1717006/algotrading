import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        success: { DEFAULT: '#22c55e', dark: '#16a34a' },
        danger: { DEFAULT: '#ef4444', dark: '#dc2626' },
        warning: { DEFAULT: '#f59e0b', dark: '#d97706' },
      },
    },
  },
  plugins: [],
};

export default config;
