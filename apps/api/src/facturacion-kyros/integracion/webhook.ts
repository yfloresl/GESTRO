import { CONVENCION } from './convencion';

/**
 * R2. `asegurarWebhookCon`: logica PURA e idempotente para dejar UNA suscripcion de webhook en FacturaSIN con la URL publica derivada. Se apoya en un
 * puerto (el adaptador HTTP) para probarla sin red. Orden: (1) upsert del enlace (`PUT /integraciones/webhooks`) si FacturaSIN ya lo tiene; (2) si no,
 * crear + borrar la anterior con la API existente (`POST/GET/DELETE /webhooks`). Nunca deja dos suscripciones del mismo sistema/empresa.
 */
export interface SuscripcionRemota { id: string; url: string; activo?: boolean }
export interface PuertoWebhooks {
  /** `null` si FacturaSIN aun no tiene el upsert (404/405/501). */
  upsert(o: { tenantId: string; url: string; eventos: readonly string[]; rotarSecreto: boolean }): Promise<{ estado: 'creada' | 'actualizada' | 'sin_cambios'; id: string | null; secreto: string | null } | null>;
  listar(): Promise<SuscripcionRemota[]>;
  crear(url: string, eventos: readonly string[]): Promise<{ id: string; secreto: string }>;
  borrar(id: string): Promise<void>;
}
export interface EstadoWebhookLocal { url: string | null; id: string | null; tieneSecreto: boolean }
export interface ResultadoWebhook {
  ok: boolean;
  accion: 'creada' | 'actualizada' | 'sin_cambios' | 'migrada';
  url: string;
  id: string | null;
  /** Secreto de firma NUEVO que hay que guardar cifrado (solo cuando se creo o roto). */
  secretoNuevo: string | null;
  via: 'upsert' | 'crear_y_borrar';
}

export async function asegurarWebhookCon(p: PuertoWebhooks, o: { tenantId: string; urlDestino: string; local: EstadoWebhookLocal; eventos?: readonly string[] }): Promise<ResultadoWebhook> {
  const eventos = o.eventos ?? CONVENCION.eventosWebhook;
  // Sin secreto guardado no se puede verificar la firma: hay que rotar/crear para obtener uno.
  const viaUpsert = await p.upsert({ tenantId: o.tenantId, url: o.urlDestino, eventos, rotarSecreto: !o.local.tieneSecreto });
  if (viaUpsert) {
    const cambioDominio = !!o.local.url && o.local.url !== o.urlDestino;
    return { ok: true, accion: cambioDominio && viaUpsert.estado === 'actualizada' ? 'migrada' : viaUpsert.estado, url: o.urlDestino, id: viaUpsert.id, secretoNuevo: viaUpsert.secreto, via: 'upsert' };
  }
  const existentes = (await p.listar()).filter((s) => s.activo !== false);
  if (existentes.length === 1 && existentes[0]!.url === o.urlDestino && o.local.tieneSecreto) {
    return { ok: true, accion: 'sin_cambios', url: o.urlDestino, id: existentes[0]!.id, secretoNuevo: null, via: 'crear_y_borrar' };
  }
  const nueva = await p.crear(o.urlDestino, eventos);
  // La nueva ya existe: ahora se borran las demas (URL vieja y duplicados). Si un borrado falla no se pierde la nueva; se reintenta en la siguiente verificacion.
  for (const s of existentes) {
    try { await p.borrar(s.id); } catch { /* reintento en el siguiente ciclo */ }
  }
  const migro = existentes.some((s) => s.url !== o.urlDestino);
  return { ok: true, accion: migro ? 'migrada' : existentes.length ? 'actualizada' : 'creada', url: o.urlDestino, id: nueva.id, secretoNuevo: nueva.secreto, via: 'crear_y_borrar' };
}

/** R5. Traduce un fallo a un mensaje que dice que paso y que hace el sistema solo (nunca «HTTP 400» crudo ni «ve a Keycloak»). */
export function mensajeWebhook(e: unknown): string {
  const est = Number((e as { estado?: number } | null)?.estado ?? 0);
  if (est === 401 || est === 403) return 'FacturaSIN no reconocio la credencial del sistema. El sistema se vuelve a enlazar solo en el proximo intento.';
  if (est === 404) return 'FacturaSIN todavia no tiene creada la empresa de este sistema. Se crea sola y se reintenta en 5 minutos.';
  if (est === 422 || est === 400) return 'FacturaSIN rechazo la direccion del aviso (debe ser publica y https). El sistema la vuelve a derivar en la proxima visita.';
  if (est >= 500) return 'FacturaSIN no esta disponible ahora. El sistema reintenta solo cada 5 minutos.';
  return 'No se pudo hablar con FacturaSIN. El sistema reintenta solo cada 5 minutos.';
}
