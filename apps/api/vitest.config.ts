import { defineConfig } from 'vitest/config';

const PG = process.env.GESTRO_PG_PUERTO ?? '5434';   // solo pruebas locales

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globalSetup: ['./test/preparar.ts'],
    // Las pruebas usan su propia base y sus propias carpetas: nunca tocan los datos de desarrollo.
    env: {
      BASE_DE_DATOS: `postgresql://gestro@127.0.0.1:${PG}/gestro_pruebas`,
      DIR_SECRETOS: './.datos/pruebas/secretos',
      DIR_ARCHIVOS: './.datos/pruebas/archivos',
    },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
