import { confirmar, pedirTexto } from '../componentes/Dialogos';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ListaEsqueleto } from '../componentes/Esqueleto';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError } from '../lib/sesion';
import { bs } from '../lib/tipos';

type Estado = 'pendiente' | 'emitiendo' | 'en_proceso' | 'emitida' | 'observada' | 'rechazada' | 'anulada';
interface Fila {
  pagoId: string; facturaId: string | null; cliente: string; sucursal: string; nit: string | null; monto: string; validadoEn: string | null; estado: Estado; simulada: boolean; sinFactura: boolean;
  numero: number | null; total: string | null; iva: string | null; comprador: { nombre: string; documento: string; consumidorFinal: boolean } | null; intentos: number; error: string | null; errorCodigo: string | null; reintentable: boolean; horasSinFactura: number;
}
interface Totales { pagos: number; cobrado: string; facturado: string; iva: string; ivaRecalculado: string; anulado: string; porFacturar: string; control: { ivaCoincide: boolean; filasIvaDistinto: number; filasIvaDistintoDeFacturaSin: number; filasTotalDistintoDelPago: number } }
interface Alertas { sinFactura: number; enAlerta: number; criticas: number; rechazadas: number; sinDatosFiscales: number; integracionActiva: boolean }
interface Lista { filas: Fila[]; totales: Totales; alertas: Alertas }
interface Integracion { config: { activo: boolean; url: string; empresa: string; clientId: string }; secretoConfigurado: boolean; webhookConfigurado: boolean; lista: boolean }
type Resultado = { ok: boolean; estado: Estado; codigo?: string; mensaje?: string };

const ETIQUETA: Record<string, { t: string; c: string }> = {
  pendiente: { t: 'Pendiente de emitir', c: 'bg-secondary-fixed text-on-secondary-fixed-variant' }, emitiendo: { t: 'Emitiendo…', c: 'bg-secondary-fixed text-on-secondary-fixed-variant' },
  en_proceso: { t: 'En proceso (SIN)', c: 'bg-secondary-container text-on-secondary-container' }, emitida: { t: 'Emitida', c: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' },
  observada: { t: 'Observada', c: 'bg-error-container text-on-error-container' }, rechazada: { t: 'Rechazada', c: 'bg-error-container text-on-error-container' }, anulada: { t: 'Anulada', c: 'bg-surface-container text-on-surface-variant' },
};
const FILTROS: [string, string][] = [['todos', 'Todos'], ['pendiente', 'Pendientes de emitir'], ['emitida', 'Emitidas'], ['simulada', 'Simuladas'], ['rechazada', 'Rechazadas'], ['anulada', 'Anuladas']];
const MOTIVOS = ['1 · Factura mal emitida', '2 · Datos del comprador incorrectos', '3 · Factura emitida sin concretar la venta', '4 · Devolución o rescisión de servicio'];

/** Panel SuperAdmin «Facturación de Kyros»: Kyros-Tech factura a sus clientes por la suscripción, vía FacturaSIN (hoy en simulación). */
export function PlataformaFacturacion() {
  const qc = useQueryClient();
  const [estado, setEstado] = useState('todos'); const [cliente, setCliente] = useState(''); const [mes, setMes] = useState('');
  const [error, setError] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [ocupado, setOcupado] = useState<string | null>(null);
  const qs = new URLSearchParams({ estado, ...(cliente.trim() && { cliente: cliente.trim() }), ...(mes && { mes }) }).toString();
  const q = useQuery({ queryKey: ['plat-fact-kyros', qs], queryFn: () => api.get<Lista>(`/plataforma/facturacion-kyros?${qs}`), refetchInterval: 30_000 });
  const integ = useQuery({ queryKey: ['plat-fact-kyros-integ'], queryFn: () => api.get<Integracion>('/plataforma/facturacion-kyros/integracion') });
  const refrescar = () => Promise.all([qc.invalidateQueries({ queryKey: ['plat-fact-kyros'] }), qc.invalidateQueries({ queryKey: ['plat-fact-kyros-integ'] })]);

  const correr = async (clave: string, f: () => Promise<unknown>, ok?: (r: any) => string) => {
    setError(null); setMsg(null); setOcupado(clave);
    try { const r = await f(); const m = ok?.(r); if (m) setMsg(m); await refrescar(); } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(null); }
  };
  const emitir = (x: Fila, op: { consumidorFinal?: boolean; excepcionNit?: boolean } = {}) => correr(x.pagoId, () => api.post<Resultado>(`/plataforma/facturacion-kyros/pagos/${x.pagoId}/${x.facturaId ? 'reintentar' : 'emitir'}`, op),
    (r: Resultado) => (r.ok ? `Factura ${r.estado === 'emitida' ? 'emitida' : 'en proceso'}.` : `No se pudo emitir: ${r.mensaje ?? r.codigo}. El pago sigue validado y la suscripción activa.`));
  const sinDatos = async (x: Fila) => { if (await confirmar({ titulo: 'Emitir como consumidor final', mensaje: `El cliente «${x.cliente}» no tiene NIT/razón social cargados. Se emitirá a «S/N» (consumidor final) y quedará marcado; esa factura no da crédito fiscal al cliente. ¿Continuar?`, aceptar: 'Emitir' })) await emitir(x, { consumidorFinal: true }); };
  const anular = async (x: Fila) => {
    const m = await pedirTexto({ titulo: 'Anular factura', mensaje: `Motivo (1 a 4):\n${MOTIVOS.join('\n')}`, etiqueta: 'Número del motivo', valor: '1', obligatorio: true, minimo: 1, maximo: 1, teclado: 'numeric' }); if (!m) return;
    const c = await pedirTexto({ titulo: 'Comentario de la anulación', etiqueta: 'Comentario (obligatorio)', obligatorio: true, minimo: 3, maximo: 200 }); if (!c) return;
    await correr(x.pagoId, () => api.post(`/plataforma/facturacion-kyros/facturas/${x.facturaId}/anular`, { motivo: Number(m), comentario: c }), () => 'Factura anulada.');
  };
  const abrir = (x: Fila, tipo: 'pdf' | 'xml' | 'qr') => correr(`${x.pagoId}-${tipo}`, async () => { const b = await api.blob(`/plataforma/facturacion-kyros/facturas/${x.facturaId}/${tipo}`); const u = URL.createObjectURL(b); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60_000); });
  const csv = () => correr('csv', async () => { const b = await api.blob(`/plataforma/facturacion-kyros/exportar.csv?${qs}`); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'facturacion-kyros.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10_000); });
  const alternar = () => correr('integ', () => api.put('/plataforma/facturacion-kyros/integracion', { activo: !integ.data?.config.activo }), () => 'Configuración guardada.');
  const suscribir = async () => { const u = await pedirTexto({ titulo: 'Webhook de retorno', mensaje: 'URL pública https de GESTRO que recibirá los eventos de FacturaSIN.', etiqueta: 'URL', valor: `${window.location.origin}/api/v1/webhooks/facturasin`, obligatorio: true, minimo: 12, maximo: 300 }); if (u) await correr('wh', () => api.post('/plataforma/facturacion-kyros/webhook/suscribir', { url: u }), () => 'Webhook suscrito (el secreto se guardó cifrado y no se muestra).'); };

  const t = q.data?.totales; const al = q.data?.alertas; const ig = integ.data;
  return (
    <section className="flex flex-col gap-space-md">
      <p role="note" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm font-label-md">Ambiente de pruebas / sin validez fiscal: hoy FacturaSIN opera contra un SIN simulado y Kyros-Tech S.R.L. usa un NIT ficticio. Ninguna de estas facturas es un documento tributario real.</p>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {msg && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-wrap items-center justify-between gap-space-sm">
        <div><h2 className="font-headline-sm text-headline-sm">Integración con FacturaSIN</h2>
          <p className="font-body-sm text-on-surface-variant">{ig ? `${ig.config.url} · empresa ${ig.config.empresa} · client ${ig.config.clientId}` : '…'}</p>
          <p className="font-body-sm">{ig?.config.activo ? 'Activa' : 'Apagada'} · secreto de gestro-service: {ig?.secretoConfigurado ? 'configurado' : 'FALTA (Integraciones)'} · webhook: {ig?.webhookConfigurado ? 'configurado' : 'sin configurar'}</p></div>
        <div className="flex flex-wrap gap-space-sm"><button type="button" onClick={alternar} disabled={!!ocupado} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>{ig?.config.activo ? 'Apagar' : 'Activar'}</button>
          <button type="button" onClick={suscribir} disabled={!!ocupado || !ig?.lista} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>Suscribir webhook</button>
          <button type="button" onClick={() => correr('conc', () => api.post<{ conciliadas: number; reintentadas: number; emitidas: number }>('/plataforma/facturacion-kyros/conciliar'), (r) => `Conciliación: ${r.conciliadas} conciliadas, ${r.reintentadas} reintentadas, ${r.emitidas} emitidas.`)} disabled={!!ocupado || !ig?.lista} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>Conciliar ahora</button></div>
      </div>

      {al && al.sinFactura > 0 && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm"><strong>{al.sinFactura} pago(s) validado(s) sin factura</strong>{al.criticas ? ` · ${al.criticas} con más de 24 h` : al.enAlerta ? ` · ${al.enAlerta} con más de 1 h` : ''}{al.rechazadas ? ` · ${al.rechazadas} rechazada(s)` : ''}{al.sinDatosFiscales ? ` · ${al.sinDatosFiscales} sin NIT del cliente` : ''}. Es una alerta: las suscripciones siguen activas.{!al.integracionActiva && ' La integración está apagada.'}</p>}

      {t && <dl className="grid grid-cols-2 gap-gutter sm:grid-cols-3 lg:grid-cols-6">
        {([['Pagos', String(t.pagos)], ['Cobrado', bs(t.cobrado)], ['Facturado', bs(t.facturado)], ['IVA 13 % (por dentro)', bs(t.iva)], ['Anulado', bs(t.anulado)], ['Por facturar', bs(t.porFacturar)]] as const).map(([k, v]) => <div key={k} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-sm"><dt className={clases.etiqueta}>{k}</dt><dd className="font-headline-sm text-headline-sm font-label-lg">{v}</dd></div>)}
        <p className={`col-span-full font-body-sm ${t.control.ivaCoincide && !t.control.filasTotalDistintoDelPago ? 'text-on-surface-variant' : 'text-error font-semibold'}`}>Control exacto en centavos: IVA recalculado {bs(t.ivaRecalculado)} {t.control.ivaCoincide ? '= IVA guardado' : `≠ IVA guardado (${t.control.filasIvaDistinto} fila(s))`}; {t.control.filasIvaDistintoDeFacturaSin} difieren del IVA de FacturaSIN; {t.control.filasTotalDistintoDelPago} facturas no igualan lo cobrado.</p>
      </dl>}

      <div className="flex flex-wrap items-end gap-space-sm">
        <div className="flex gap-space-xs flex-wrap" role="group" aria-label="Estado">{FILTROS.map(([k, n]) => <button key={k} aria-pressed={estado === k} onClick={() => setEstado(k)} className={`h-12 px-space-md rounded-lg font-semibold ${estado === k ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Cliente o NIT</span><input value={cliente} onChange={(e) => setCliente(e.target.value)} maxLength={80} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Mes (pago validado)</span><input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className={clases.input} /></label>
        <button type="button" onClick={csv} disabled={!!ocupado} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>Exportar CSV</button>
      </div>

      {q.isLoading ? <ListaEsqueleto /> : (q.data?.filas ?? []).length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">No hay pagos validados con ese filtro.</p> : (
        <ul className="grid grid-cols-1 gap-gutter xl:grid-cols-2">{q.data!.filas.map((x) => {
          const e = ETIQUETA[x.estado]!; const trab = ocupado?.startsWith(x.pagoId);
          return (
            <li key={x.pagoId} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
              <div className="flex flex-wrap items-start justify-between gap-space-sm"><div><h3 className="font-headline-sm text-headline-sm">{x.cliente}</h3><p className="font-body-sm text-on-surface-variant">{x.sucursal} · NIT {x.nit ?? 'sin NIT'} · validado {x.validadoEn ? new Date(x.validadoEn).toLocaleString('es-BO') : '—'}</p></div>
                <div className="flex flex-col items-end gap-1"><span className="font-headline-sm text-primary font-label-lg">{bs(x.monto)}</span><span className="flex gap-1"><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase ${e.c}`}>{e.t}</span>{x.simulada && <span className="px-2 py-0.5 rounded-full font-label-sm uppercase bg-secondary-fixed text-on-secondary-fixed-variant">Simulada</span>}</span></div></div>
              {x.facturaId && x.total && <p className="font-body-sm">N.º {x.numero ?? '—'} · total {bs(x.total)} · IVA {bs(x.iva ?? '0')} · comprador {x.comprador?.nombre} ({x.comprador?.documento}){x.comprador?.consumidorFinal ? ' · CONSUMIDOR FINAL' : ''}</p>}
              {x.sinFactura && x.horasSinFactura >= 1 && <p className="font-body-sm text-error">Sin factura hace {x.horasSinFactura} h{x.horasSinFactura >= 24 ? ' (crítico)' : ''}.</p>}
              {x.error && <p className="font-body-sm text-error">{x.errorCodigo}: {x.error}{x.intentos ? ` (intentos: ${x.intentos})` : ''}</p>}
              {!x.error && x.errorCodigo === 'SIN_DATOS_FISCALES' && <p className="font-body-sm text-error">El cliente no tiene NIT/razón social válidos. Pídele que los cargue en Suscripción › Datos para tu factura, o emite como consumidor final.</p>}
              <div className="flex flex-wrap gap-space-xs">
                {(x.estado === 'pendiente' || x.estado === 'rechazada' || x.estado === 'emitiendo') && <button type="button" disabled={!!ocupado} onClick={() => emitir(x)} className={`${clases.primario} sm:w-auto sm:px-space-md`}>{trab ? 'Emitiendo…' : x.facturaId ? 'Reintentar' : 'Emitir factura'}</button>}
                {x.estado === 'pendiente' && x.errorCodigo === 'SIN_DATOS_FISCALES' && <button type="button" disabled={!!ocupado} onClick={() => sinDatos(x)} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>Emitir como consumidor final</button>}
                {x.estado === 'pendiente' && x.error?.includes('NIT') && <button type="button" disabled={!!ocupado} onClick={() => emitir(x, { excepcionNit: true })} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>Emitir con excepción de NIT</button>}
                {x.facturaId && ['emitida', 'en_proceso', 'observada', 'anulada'].includes(x.estado) && (['pdf', 'xml', 'qr'] as const).map((tp) => <button key={tp} type="button" disabled={!!ocupado} onClick={() => abrir(x, tp)} className={`${clases.secundario} sm:w-auto sm:px-space-md uppercase`}>{tp}</button>)}
                {x.estado === 'emitida' && <button type="button" disabled={!!ocupado} onClick={() => anular(x)} className="h-12 px-space-md rounded-lg border border-error text-error font-semibold">Anular…</button>}
              </div>
            </li>);
        })}</ul>
      )}
    </section>
  );
}
