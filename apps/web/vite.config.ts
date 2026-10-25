import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, strictPort: true,
    // En desarrollo Vite reenvía la API; en producción lo hace el gateway. Mismo origen, sin CORS.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.spec.ts'] },
});
