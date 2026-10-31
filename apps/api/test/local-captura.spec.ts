// Arnés LOCAL y descartable (no corre en la suite normal): levanta la API real con la demo cargada en 127.0.0.1:4000
// para recorrer la web a mano o tomar capturas. Uso: CAPTURA=1 pnpm vitest run test/local-captura.spec.ts
import { createConnection, createServer } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUB_PRUEBA_KYROS, SUB_PRUEBA_KYROS_ASISTENTE, SUB_PRUEBA_KYROS_COCINA, SUB_PRUEBA_KYROS_MESERO } from '../src/demo/constantes';
import { levantar } from './util';

describe.skipIf(!process.env.CAPTURA)('arnés local', () => {
  it('sirve la demo en :4000 hasta que exista .local/parar', async () => {
    const t = await levantar(); const plat = await t.nuevaPlataforma();
    await plat.del('/plataforma/demo'); expect((await plat.post('/plataforma/demo', { dias: 75 })).status).toBe(200);
    const destino = Number(new URL(t.url).port);
    createServer((c) => { const s = createConnection(destino, '127.0.0.1'); c.pipe(s); s.pipe(c); c.on('error', () => s.destroy()); s.on('error', () => c.destroy()); }).listen(4000, '127.0.0.1');
    const tokens: Record<string, string[]> = {};
    for (const [n, sub] of Object.entries({ dueno: SUB_PRUEBA_KYROS, caja: SUB_PRUEBA_KYROS_ASISTENTE, cocina: SUB_PRUEBA_KYROS_COCINA, mesero: SUB_PRUEBA_KYROS_MESERO })) tokens[n] = Array.from({ length: 25 }, () => t.firmar({ sub, exp: Math.floor(Date.now() / 1000) + 7200 }));
    writeFileSync('../../.local/tokens.json', JSON.stringify(tokens));
    writeFileSync('../../.local/listo', 'ok');
    while (!existsSync('../../.local/parar')) await new Promise((r) => setTimeout(r, 3000));
    await t.cerrar();
  }, 4 * 3600_000);
});
