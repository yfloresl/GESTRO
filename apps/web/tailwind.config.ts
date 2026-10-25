import type { Config } from 'tailwindcss';
import tokens from './tokens.json';

// Los tokens salen tal cual del diseño Stitch (.design/DESIGN.md). Nada de valores inventados.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: tokens as unknown as Record<string, unknown> },
} satisfies Config;
