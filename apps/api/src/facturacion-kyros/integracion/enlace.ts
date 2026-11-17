import type { PuertoWebhooks } from './webhook';

/**
 * R4. Adaptador del lado sistema del ENLACE AUTOMATICO con FacturaSIN (interfaz v1, informe QA-FACTURACION-INTEGRACION seccion 19).
 * No importa nada del sistema: recibe una funcion `llamar` (FacturaSinClient.llamar) ya autenticada. Si FacturaSIN aun no publica la interfaz
 * (404/405/501), cada metodo devuelve `null` y el sistema sigue funcionando con la credencial puente (client `<sistema>-service`).
 */
export type Llamar = (metodo: string, ruta: string, o?: { cuerpo?: unknown; cab?: Record<string, string> }) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const ausente = (e: unknown): boolean => [404, 405, 501].includes(Number((e as { estado?: number } | null)?.estado ?? 0));

export interface CredencialEnlazada { valor: string; id: string; prefijo: string }

/** `POST /v1/integraciones/enlazar`: devuelve la credencial propia (`fsk_...`, se muestra UNA vez) o `null` si la interfaz no existe todavia. */
export async function enlazarSistema(llamar: Llamar, o: { sistema: string; dominioPublico?: string; version: string }): Promise<{ credencial: CredencialEnlazada | null; empresaKyros: { externo: string; requiereRubro?: boolean } | null } | null> {
  try {
    const r = await llamar('POST', '/v1/integraciones/enlazar', { cuerpo: { sistema: o.sistema, ...(o.dominioPublico ? { dominioPublico: o.dominioPublico } : {}), version: o.version } });
    return { credencial: r?.credencial?.valor ? { valor: String(r.credencial.valor), id: String(r.credencial.id ?? ''), prefijo: String(r.credencial.prefijo ?? '') } : null, empresaKyros: r?.empresaKyros ?? null };
  } catch (e) {
    if (ausente(e)) return null;
    throw e;
  }
}

/** Puerto de webhooks sobre la API de FacturaSIN. `cabEmpresa` = valor de `X-Empresa-Externa` para la API clasica. */
export function puertoWebhooks(llamar: Llamar, cabEmpresa: string): PuertoWebhooks {
  const cab = { 'X-Empresa-Externa': cabEmpresa };
  return {
    async upsert(o) {
      try {
        const r = await llamar('PUT', '/v1/integraciones/webhooks', { cuerpo: { tenantId: o.tenantId, url: o.url, eventos: [...o.eventos], rotarSecreto: o.rotarSecreto } });
        const s = Array.isArray(r?.suscripciones) ? r.suscripciones[0] : null;
        return { estado: (s?.estado as 'creada' | 'actualizada' | 'sin_cambios') ?? 'sin_cambios', id: s?.id ?? null, secreto: typeof r?.secreto === 'string' ? r.secreto : null };
      } catch (e) {
        if (ausente(e)) return null;
        throw e;
      }
    },
    async listar() {
      const r = await llamar('GET', '/v1/webhooks', { cab });
      const lista = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
      return lista.map((w: { id: string; url: string; activo?: boolean }) => ({ id: String(w.id), url: String(w.url), activo: w.activo }));
    },
    async crear(url, eventos) {
      const r = await llamar('POST', '/v1/webhooks', { cuerpo: { url, eventos: [...eventos] }, cab });
      return { id: String(r.id), secreto: String(r.secreto) };
    },
    async borrar(id) { await llamar('DELETE', `/v1/webhooks/${encodeURIComponent(id)}`, { cab }); },
  };
}

/** `PUT /v1/integraciones/empresas/{tenantId}`: crea/asegura la empresa `<sistema>:<tenantId>` con los datos fiscales que el sistema ya tiene. `null` si la interfaz no existe. */
export async function asegurarEmpresa(llamar: Llamar, tenantId: string, datos: Record<string, unknown>): Promise<{ estado: string; externo: string } | null> {
  try {
    const r = await llamar('PUT', `/v1/integraciones/empresas/${encodeURIComponent(tenantId)}`, { cuerpo: datos });
    return { estado: String(r?.estado ?? 'actualizada'), externo: String(r?.externo ?? '') };
  } catch (e) {
    if (ausente(e)) return null;
    throw e;
  }
}
