import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Brand: deep desert blue + sand
        brand: {
          50:  '#eef4ff',
          100: '#d9e5ff',
          200: '#b9ccff',
          500: '#3a64f0',
          600: '#2d4fd6',
          700: '#2540ac',
          900: '#162870',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
