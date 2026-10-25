import type { CanjeKyrosId, KyrosIdPublico, Registro, ResultadoCanje, SesionRespuesta, SucursalVista } from '@gestro/contracts';

/** Cliente tipado de la API. El token de acceso vive solo en memoria del navegador. */
export class GestroClient {
  private token: string | null = null;
  constructor(private readonly base = '/api/v1') {}

  setToken(t: string | null) { this.token = t; }

  private async pedir<T>(ruta: string, init: RequestInit & { sucursal?: string } = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);
    if (init.sucursal) headers.set('x-restaurant-id', init.sucursal);
    const r = await fetch(`${this.base}${ruta}`, { ...init, headers, credentials: 'same-origin' });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, cuerpo: await r.json().catch(() => null) });
    return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
  }

  kyrosIdConfig() { return this.pedir<KyrosIdPublico>('/auth/kyros-id/config'); }
  kyrosIdCanjear(d: CanjeKyrosId) { return this.pedir<ResultadoCanje>('/auth/kyros-id/sesion', { method: 'POST', body: JSON.stringify(d) }); }
  kyrosIdVincular(d: { registroToken: string; codigo: string }) { return this.pedir<SesionRespuesta>('/auth/kyros-id/vincular', { method: 'POST', body: JSON.stringify(d) }); }
  kyrosIdRegistrar(d: Registro) { return this.pedir<SesionRespuesta>('/auth/kyros-id/registro', { method: 'POST', body: JSON.stringify(d) }); }
  sucursal(rid: string) { return this.pedir<SucursalVista>('/sucursal', { sucursal: rid }); }
  private refrescando: Promise<SesionRespuesta> | null = null;
  /** Un solo refresco en vuelo: llamadas simultáneas comparten la misma respuesta (el refresco es rotativo). */
  refrescar() {
    this.refrescando ??= this.pedir<SesionRespuesta>('/auth/refrescar', { method: 'POST' }).finally(() => { this.refrescando = null; });
    return this.refrescando;
  }
  salir() { return this.pedir<void>('/auth/salir', { method: 'POST' }); }
  yo(sucursal?: string) { return this.pedir<SesionRespuesta>('/auth/yo', { sucursal }); }
}
