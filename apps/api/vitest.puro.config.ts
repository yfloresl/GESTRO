import { defineConfig } from 'vitest/config';
/** Pruebas puras (sin base de datos): `pnpm exec vitest run -c vitest.puro.config.ts`. */
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.puro.spec.ts'], testTimeout: 30000 } });
