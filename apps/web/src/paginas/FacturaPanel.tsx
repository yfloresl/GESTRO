import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { clases } from '../componentes/Marca';
import { AvisoPruebas } from './FacturacionConfig';
import { bs } from '../lib/tipos';

export interface Factura {
  id: string; pedidoId: string; intento: number; estado: string; pendienteDeEmitir: boolean;
  comprador: { tipoDocumento: number; numeroDocumento: string; complemento: string | null; razonSocial: string; correo: string | null; consumidorFinal: boolean };
  subtotal: string; descuento: string; total: string; ivaReferencial: string; propinaNoFacturada: string; numero: number | null; cuf: string | null; emitida: string | null; qrTexto: string | null;
  aviso: string | null; ambientePruebas: boolean; puedeImprimir: boolean; error: string | null; reintentos: number; proximoReintento: string | null;
  anulacion: { motivo: string | null; cuando: string | null } | null; creada: string; ticket?: string | null;
  /** La factura tal como la devolvió el SIN (desglose, fecha, enlaces); null hasta que llegue. */
  registrada?: { desglose: { neto?: number; iva?: number; total?: number; modoIva?: string } | null; fecha: string | null; enlaces: unknown; ambientePruebas: boolean } | null;
}
export const ETIQUETA_FACTURA: Record<string, string> = {
  en_cola: 'Pendiente de emitir', pendiente: 'Esperando al SIN', validada: 'Validada', observada: 'Observada por el SIN', contingencia: 'Emitida sin conexión (en contingencia)',
  rechazada: 'Rechazada por el SIN', error_datos: 'Datos a corregir', anulada: 'Anulada',
};
const TIPOS = [['nit', 'NIT'], ['ci', 'CI'], ['pasaporte', 'Pasaporte'], ['cex', 'Carnet de extranjero'], ['otro', 'Otro documento']] as const;

export interface DatosComensal { tipo: (typeof TIPOS)[number][0]; numero: string; complemento: string; razon: string; correo: string; excepcion: boolean; final: boolean; t1: string; t4: string }
export const comensalVacio: DatosComensal = { tipo: 'nit', numero: '', complemento: '', razon: '', correo: '', excepcion: false, final: false, t1: '', t4: '' };

/** Arma el cuerpo de «facturar» o devuelve el primer error de validación (el servidor vuelve a validar todo). */
export function cuerpoDeFactura(d: DatosComensal, conTarjeta: boolean): { cuerpo?: Record<string, unknown>; error?: string } {
  const tarjeta = conTarjeta ? { tarjeta: { primeros4: d.t1.trim(), ultimos4: d.t4.trim() } } : {};
  if (conTarjeta && !(/^\d{4}$/.test(d.t1.trim()) && /^\d{4}$/.test(d.t4.trim()))) return { error: 'Tarjeta: escribe los primeros 4 y los últimos 4 dígitos.' };
  if (d.final) return { cuerpo: { consumidorFinal: true, ...tarjeta } };
  const n = d.numero.trim();
  if (d.tipo === 'nit' && !/^\d{5,13}$/.test(n)) return { error: 'El NIT son solo números, de 5 a 13 dígitos.' };
  if (d.tipo === 'ci' && !/^\d{4,10}$/.test(n)) return { error: 'El CI son solo números (4 a 10 dígitos); el complemento va aparte.' };
  if (d.tipo === 'cex' && !/^\d{4,12}$/.test(n)) return { error: 'El carnet de extranjero son solo números (4 a 12 dígitos).' };
  if ((d.tipo === 'pasaporte' || d.tipo === 'otro') && !/^[A-Za-z0-9-]{4,20}$/.test(n)) return { error: 'El documento: de 4 a 20 letras o números.' };
  if (!d.razon.trim()) return { error: 'Escribe la razón social o el nombre del comensal.' };
  if (d.correo.trim() && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(d.correo.trim())) return { error: 'El correo no es válido.' };
  return { cuerpo: { comprador: { tipo: d.tipo, numero: n, ...(d.complemento.trim() ? { complemento: d.complemento.trim() } : {}), razonSocial: d.razon, ...(d.correo.trim() ? { correo: d.correo.trim() } : {}), ...(d.excepcion && d.tipo === 'nit' ? { nitConExcepcion: true } : {}) }, ...tarjeta } };
}

/** Datos del comensal para la factura (compartido por «Cobrar» y por «Facturar» después del cobro). */
export function ComensalCampos({ v, cambiar, permiteFinal, conTarjeta }: { v: DatosComensal; cambiar(p: Partial<DatosComensal>): void; permiteFinal: boolean; conTarjeta: boolean }) {
  return (
    <div className="flex flex-col gap-space-sm">
      {permiteFinal && <label className="flex items-center gap-space-sm min-h-11"><input type="checkbox" checked={v.final} onChange={(e) => cambiar({ final: e.target.checked })} className="w-5 h-5" /><span>Sin nombre (consumidor final)</span></label>}
      {!v.final && (
        <>
          <div className="grid grid-cols-[9rem_1fr] gap-space-sm">
            <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Documento</span><select value={v.tipo} onChange={(e) => cambiar({ tipo: e.target.value as DatosComensal['tipo'], excepcion: false })} className={clases.input}>{TIPOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Número</span><input value={v.numero} onChange={(e) => cambiar({ numero: e.target.value })} inputMode={v.tipo === 'pasaporte' || v.tipo === 'otro' ? 'text' : 'numeric'} autoComplete="off" className={clases.input} /></label>
          </div>
          {v.tipo === 'ci' && <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Complemento del CI (opcional)</span><input value={v.complemento} onChange={(e) => cambiar({ complemento: e.target.value })} maxLength={5} className={clases.input} /></label>}
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Razón social o nombre</span><input value={v.razon} onChange={(e) => cambiar({ razon: e.target.value })} maxLength={200} autoComplete="off" className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Correo (opcional)</span><input value={v.correo} onChange={(e) => cambiar({ correo: e.target.value })} inputMode="email" className={clases.input} /></label>
          {v.tipo === 'nit' && <label className="flex items-start gap-space-sm min-h-11"><input type="checkbox" checked={v.excepcion} onChange={(e) => cambiar({ excepcion: e.target.checked })} className="w-5 h-5 mt-1" /><span className="font-body-sm">El SIN no reconoce este NIT pero el comensal lo pide igual (excepción de NIT).</span></label>}
        </>
      )}
      {conTarjeta && <div className="grid grid-cols-2 gap-space-sm"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Tarjeta: primeros 4</span><input value={v.t1} onChange={(e) => cambiar({ t1: e.target.value })} inputMode="numeric" maxLength={4} className={clases.input} /></label><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Tarjeta: últimos 4</span><input value={v.t4} onChange={(e) => cambiar({ t4: e.target.value })} inputMode="numeric" maxLength={4} className={clases.input} /></label></div>}
    </div>
  );
}

export const abrirPdf = async (id: string, sucursalId: string, formato: 'a4' | 'rollo' = 'a4') => {
  const b = await api.blob(`/facturas/${id}/pdf?formato=${formato}`, sucursalId);
  const url = URL.createObjectURL(b); window.open(url, '_blank', 'noopener'); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const MOTIVOS = [[1, 'Factura mal emitida'], [3, 'Datos de emisión incorrectos'], [4, 'Factura devuelta']] as const;

/** Estado de la factura de un pedido cobrado: ver/imprimir, reintentar, anular con motivo o emitirla si todavía no existe. */
export function FacturaPanel({ pedidoId }: { pedidoId: string }) {
  const { sucursalId, esAdmin } = useRolesActivos(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['factura-de', pedidoId], queryFn: () => api.get<{ factura: Factura | null; historial: Factura[]; cobro: { metodo: string } | null }>(`/pedidos/${pedidoId}/factura`, sucursalId!), enabled: !!sucursalId, refetchInterval: (s) => (['en_cola', 'pendiente', 'contingencia'].includes(s.state.data?.factura?.estado ?? '') ? 15_000 : false) });
  const est = useQuery({ queryKey: ['fact-estado', sucursalId], queryFn: () => api.get<{ disponible: boolean; permiteConsumidorFinal: boolean; aviso: string | null }>('/facturacion/estado', sucursalId!), enabled: !!sucursalId });
  const [error, setError] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false);
  const [datos, setDatos] = useState<DatosComensal>(comensalVacio); const [abierto, setAbierto] = useState(false);
  const [anular, setAnular] = useState(false); const [motivo, setMotivo] = useState(1); const [comentario, setComentario] = useState('');
  const f = q.data?.factura ?? null; const metodo = q.data?.cobro?.metodo;
  const refrescar = () => Promise.all([qc.invalidateQueries({ queryKey: ['factura-de', pedidoId] }), qc.invalidateQueries({ queryKey: ['facturas', sucursalId] })]);
  const ejecutar = async (fn: () => Promise<unknown>) => { setError(null); setOcupado(true); try { await fn(); await refrescar(); } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(false); } };
  const vigente = f && !['rechazada', 'error_datos', 'anulada'].includes(f.estado);

  return (
    <section aria-label="Factura" className="flex flex-col gap-space-sm border-t border-outline-variant pt-space-sm">
      <h3 className="font-headline-sm text-headline-sm">Factura</h3>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {f && (
        <div className="rounded-lg bg-surface-container p-space-sm flex flex-col gap-1" aria-live="polite">
          <p className="font-semibold">{ETIQUETA_FACTURA[f.estado] ?? f.estado}{f.numero ? ` · N.º ${f.numero}` : ''}</p>
          <p className="font-body-sm">{f.comprador.consumidorFinal ? 'Sin nombre (consumidor final)' : `${f.comprador.razonSocial} · ${f.comprador.numeroDocumento}${f.comprador.complemento ? `-${f.comprador.complemento}` : ''}`}</p>
          <p className="font-body-sm">Total facturado {bs(f.total)} · IVA incluido (13 %) {bs(f.ivaReferencial)}{Number(f.propinaNoFacturada) > 0 ? ` · propina ${bs(f.propinaNoFacturada)} (no se factura)` : ''}</p>
          {f.cuf && <p className="font-body-sm break-all">CUF: {f.cuf}</p>}
          {f.estado === 'en_cola' && <p className="font-body-sm text-error">La venta ya está cobrada. La factura aún no se pudo emitir y se reintenta sola{f.error ? ` (${f.error})` : ''}.</p>}
          {['rechazada', 'error_datos'].includes(f.estado) && <p className="font-body-sm text-error">{f.error ?? 'El SIN no aceptó la factura.'} Corrige los datos y vuelve a facturar.</p>}
          {f.anulacion && <p className="font-body-sm">Anulada: {f.anulacion.motivo}</p>}
          {f.aviso && <AvisoPruebas texto={f.aviso} />}
        </div>
      )}
      <div className="flex flex-wrap gap-space-xs">
        {f?.puedeImprimir && <button type="button" disabled={ocupado} onClick={() => void ejecutar(() => abrirPdf(f.id, sucursalId!))} className={`${clases.secundario} !w-auto px-space-md`}>Ver / imprimir factura</button>}
        {f?.estado === 'en_cola' && <button type="button" disabled={ocupado} onClick={() => void ejecutar(() => api.post(`/facturas/${f.id}/reintentar`, undefined, sucursalId!))} className={`${clases.secundario} !w-auto px-space-md`}>Reintentar ahora</button>}
        {f && vigente && esAdmin && !anular && <button type="button" onClick={() => setAnular(true)} className="h-12 px-space-md text-error font-label-lg">Anular factura</button>}
      </div>
      {anular && f && (
        <div className="rounded-lg border border-outline-variant p-space-sm flex flex-col gap-space-sm">
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Motivo SIN</span><select value={motivo} onChange={(e) => setMotivo(Number(e.target.value))} className={clases.input}>{MOTIVOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Explicación (obligatoria)</span><input value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={300} className={clases.input} /></label>
          <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={() => setAnular(false)} className="h-12 rounded-lg border border-outline-variant font-semibold">Cancelar</button>
            <button type="button" disabled={ocupado || comentario.trim().length < 3} onClick={() => void ejecutar(async () => { await api.post(`/facturas/${f.id}/anular`, { motivo, comentario: comentario.trim() }, sucursalId!); setAnular(false); setComentario(''); })} className="h-12 rounded-lg bg-error text-on-error font-semibold disabled:opacity-50">Anular</button></div>
        </div>
      )}
      {!vigente && est.data?.disponible && (
        abierto ? (
          <div className="flex flex-col gap-space-sm">
            <ComensalCampos v={datos} cambiar={(p) => setDatos((d) => ({ ...d, ...p }))} permiteFinal={est.data.permiteConsumidorFinal} conTarjeta={metodo === 'tarjeta'} />
            <button type="button" disabled={ocupado} onClick={() => { const r = cuerpoDeFactura(datos, metodo === 'tarjeta'); if (r.error) { setError(r.error); return; } void ejecutar(async () => { await api.post(`/pedidos/${pedidoId}/facturar`, r.cuerpo, sucursalId!); setAbierto(false); }); }} className={clases.primario}>{ocupado ? 'Facturando…' : 'Emitir factura'}</button>
          </div>
        ) : <button type="button" onClick={() => setAbierto(true)} className={clases.primario}><span className="material-symbols-outlined" aria-hidden="true">receipt_long</span>Facturar este pedido</button>
      )}
      {!f && est.data && !est.data.disponible && <p className="font-body-sm text-on-surface-variant">La facturación no está activada. El dueño la configura en Configuración.</p>}
      {est.data && <AvisoPruebas texto={est.data.aviso} />}
    </section>
  );
}
