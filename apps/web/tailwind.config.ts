import plugin from 'tailwindcss/plugin';
import type { Config } from 'tailwindcss';
import tokens from './tokens.json';
import oscuro from './tokens-oscuro.json';

// Los tokens claros salen tal cual del diseño Stitch (.design/DESIGN.md). El modo oscuro es DERIVADO de esos mismos
// tokens (registrado en .design/INVENTARIO.md); los colores *-fixed y los inverse-* son iguales en ambos modos (el KDS siempre es oscuro).
// Cada color es una variable CSS con soporte de opacidad (bg-primary/50), así cambiar de tema no toca ningún componente.
const claros = tokens.colors as Record<string, string>;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
const variables = (paleta: Record<string, string>) => Object.fromEntries(Object.entries(paleta).map(([k, v]) => [`--c-${k}`, rgb(v)]));
const colores = Object.fromEntries(Object.keys(claros).map((k) => [k, `rgb(var(--c-${k}) / <alpha-value>)`]));

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { ...(tokens as unknown as Record<string, unknown>), colors: colores } },
  plugins: [plugin(({ addBase }) => addBase({
    ':root': { ...variables(claros), colorScheme: 'light' },
    '.dark': { ...variables({ ...claros, ...oscuro }), colorScheme: 'dark' },
    '@media print': { '.dark': variables(claros) },
  }))],
} satisfies Config;
