import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUTA_WEBHOOK, urlWebhookDe } from '../src/facturacion-kyros/nucleo/integracion';

const leer = (rel: string) => readFileSync(join(__dirname, '..', 'src', rel), 'utf8');

describe('URL del webhook unico = prefijo global + ruta del controlador', () => {
  it('la ruta estandar del nucleo es exactamente la que sirve el controlador', () => {
    const prefijo = /setGlobalPrefix\('([^']+)'\)/.exec(leer('main.ts'))?.[1];
    const fuente = leer('facturacion-kyros/facturacion-kyros.controller.ts');
    const ctrl = /@Controller\('(webhooks)'\)\s*\r?\nexport class FacturacionKyrosWebhookController/.exec(fuente)?.[1];
    const post = /class FacturacionKyrosWebhookController[\s\S]*?@Post\('(facturasin)'\)/.exec(fuente)?.[1];
    expect(prefijo).toBe('api/v1');
    expect(`/${prefijo}/${ctrl}/${post}`).toBe(RUTA_WEBHOOK);
    expect(urlWebhookDe('https://gestro.kyros-tech.com')).toBe('https://gestro.kyros-tech.com/api/v1/webhooks/facturasin');
  });
});
