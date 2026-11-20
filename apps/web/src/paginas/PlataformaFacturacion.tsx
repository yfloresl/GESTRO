import { lineaCuf } from './lineaCuf';
import { aLenguajeSimple, GLOSARIO } from '../lib/kyros-estandar';
import { confirmar, pedirTexto } from '../componentes/Dialogos';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ListaEsqueleto } from '../componentes/Esqueleto';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError } from '../lib/sesion';
import { bs } from '../lib/tipos';

type Estado = 'pendiente' | 'emitiendo' | 'en_proceso' | 'emitida' | 'observada' | 'rechazada' | 'anulada';
interface Fila {
  pagoId: string; facturaId: string | null; cliente: string; sucursal: string; nit: string | null; monto: string; validadoEn: string | null; estado: Estado; simulada: boolean; sinFactura: boolean; vistaRegistrada?: boolean;
  numero: number | null; cuf?: string | null; emitidaEn?: string | null; total: string | null; iva: string | null; comprador: { nombre: string; documento: string; consumidorFinal: boolean } | null; intentos: number; error: string | null; errorCodigo: string | null; reintentable: boolean; horasSinFactura: number;
}
interface Totales { pagos: number; cobrado: string; facturado: string; iva: string; ivaRecalculado: string; anulado: string; porFacturar: string; control: { ivaCoincide: boolean; filasIvaDistinto: number; filasIvaDistintoDeFacturaSin: number; filasTotalDistintoDelPago: number } }
interface Alertas { sinFactura: number; enAlerta: number; criticas: number; rechazadas: number; sinDatosFiscales: number; integracionActiva: boolean }
interface Lista { filas: Fila[]; totales: Totales; alertas: Alertas }
interface EstadoEnlace { mensaje: string; webhook: { ultimaEntrega: string | null } }
interface ClienteFact { id: string; nombre: string; override: boolean | null; habilitada: boolean; motivo: string; etiqueta: string }
interface EntregaLocalAviso { fecha: string; evento: string; eventoId: string; facturaId: string | null; resultado: string; firmaValida: boolean; ms?: number }
interface EntregasAviso {
  recibidas: { total: number; firmaInvalida: number; ultima: EntregaLocalAviso | null; ultimas: EntregaLocalAviso[] };
  latencia?: { ultimaMs: number | null; maxMs: number | null; promedioMs: number | null };
  entregas: Array<{ id: string; tipo: string; estado: string; intentos: number; ultimoCodigoHttp: number | null; ultimoIntentoEn: string | null; numero?: number | null; idExterno?: string | null; facturaId?: string | null; registrada: boolean }>;
  huella: { coincide: boolean; remota: string | null; local: string | null } | null;
  error: string | null;
}
interface Integracion { enlace?: EstadoEnlace; avisoCodigos?: string | null; ivaPorFueraVigente?: boolean; config: { activo: boolean; url: string; empresa: string; clientId: string; metodoPago?: number; codigoProducto?: string; modoIva?: string; codigosConfirmados?: boolean; codigoProductoSin?: string; actividadEconomica?: string; unidadMedida?: number }; codigosSinFaltan?: string[]; secretoConfigurado: boolean; webhookConfigurado: boolean; lista: boolean }
interface CatalogoFs { nombre: string; disponible: boolean; items: Array<Record<string, unknown>>; aviso: string | null }
const txt = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** Códigos fiscales que GESTRO envía en cada ítem de la factura de Kyros-Tech: se ELIGEN del catálogo sincronizado de FacturaSIN (o se escriben a mano si no se puede consultar). */
function CodigosFiscales({ ig, ocupado, onGuardar }: { ig: Integracion; ocupado: boolean; onGuardar: (parcial: Record<string, unknown>) => void }) {
  const prod = useQuery({ queryKey: ['plat-fact-cat', 'productosServicios'], queryFn: () => api.get<CatalogoFs>('/plataforma/facturacion-kyros/catalogo/productosServicios'), retry: false, staleTime: 60_000 });
  const act = useQuery({ queryKey: ['plat-fact-cat', 'actividades'], queryFn: () => api.get<CatalogoFs>('/plataforma/facturacion-kyros/catalogo/actividades'), retry: false, staleTime: 60_000 });
  const uni = useQuery({ queryKey: ['plat-fact-cat', 'unidadMedida'], queryFn: () => api.get<CatalogoFs>('/plataforma/facturacion-kyros/catalogo/unidadMedida'), retry: false, staleTime: 60_000 });
  const [producto, setProducto] = useState<string | null>(null); const [actividad, setActividad] = useState<string | null>(null); const [unidad, setUnidad] = useState<string | null>(null);
  const vProducto = producto ?? ig.config.codigoProductoSin ?? ''; const vActividad = actividad ?? ig.config.actividadEconomica ?? ''; const vUnidad = unidad ?? String(ig.config.unidadMedida ?? '');
  const avisos = [prod.data, act.data, uni.data].map((c) => c?.aviso).filter((a): a is string => !!a);
  const lP = (prod.data?.items ?? []).filter((x) => !vActividad || !x.codigoActividad || txt(x.codigoActividad) === vActividad).map((x) => ({ v: txt(x.codigoProducto), e: `${txt(x.codigoProducto)} · ${txt(x.descripcionProducto)}` }));
  const lA = (act.data?.items ?? []).map((x) => ({ v: txt(x.codigoCaeb), e: `${txt(x.codigoCaeb)} · ${txt(x.descripcion)}` }));
  const lU = (uni.data?.items ?? []).map((x) => ({ v: txt(x.codigoClasificador), e: `${txt(x.codigoClasificador)} · ${txt(x.descripcion)}` }));
  const campo = (etiqueta: string, valor: string, set: (v: string) => void, lista: { v: string; e: string }[]) => (
    <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>{etiqueta}</span>
      {lista.length > 0
        ? <select value={valor} onChange={(e) => set(e.target.value)} className={clases.input}>{!lista.some((x) => x.v === valor) && <option value={valor}>{valor || 'Elegir del catálogo'}</option>}{lista.map((x) => <option key={x.v} value={x.v}>{x.e}</option>)}</select>
        : <input value={valor} onChange={(e) => set(e.target.value)} maxLength={12} inputMode="numeric" className={clases.input} />}
    </label>
  );
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid gap-space-sm sm:grid-cols-4">
      <h3 className="font-headline-sm text-headline-sm sm:col-span-4">Códigos fiscales del producto (se envían en cada ítem)</h3>
      <p className="font-body-sm text-on-surface-variant sm:col-span-4">FacturaSIN no registra los productos de GESTRO: este sistema envía en cada ítem el producto SIN, la actividad económica y la unidad. Elige los valores del catálogo sincronizado de FacturaSIN.</p>
      {(ig.codigosSinFaltan?.length ?? 0) > 0 && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm sm:col-span-4"><strong>Faltan códigos fiscales:</strong> {ig.codigosSinFaltan!.join(', ')}. Sin ellos la factura queda pendiente; elígelos aquí y usa «Reintentar».</p>}
      {ig.avisoCodigos && <p role="note" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm font-label-md sm:col-span-4"><strong>NO CONFIRMADO — provisional de pruebas.</strong> Los valores predeterminados salen del catálogo SIMULADO de FacturaSIN; el contador los confirma con el catálogo del SIN antes de operar en real.</p>}
      {avisos.length > 0 && <p role="note" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm font-label-md sm:col-span-4">No se pudo leer el catálogo de FacturaSIN: {avisos[0]}</p>}
      {campo('Actividad económica', vActividad, setActividad, lA)}
      {campo('Producto SIN', vProducto, setProducto, lP)}
      {campo('Unidad de medida', vUnidad, setUnidad, lU)}
      <div className="flex items-end"><button type="button" disabled={ocupado || !vProducto.trim() || !vActividad.trim() || !/^\d+$/.test(vUnidad)} onClick={() => { onGuardar({ codigoProductoSin: vProducto.trim(), actividadEconomica: vActividad.trim(), unidadMedida: Number(vUnidad) }); setProducto(null); setActividad(null); setUnidad(null); }} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>Guardar códigos</button></div>
    </div>
  );
}

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
  /** «Verificar / Reintentar»: el servidor asegura solo el enlace y el aviso de estados (sin contraseña ni URL tecleada). */
  const [qCli, setQCli] = useState('');
  const clientesFact = useQuery({ queryKey: ['fact-clientes', qCli], queryFn: () => api.get<{ clientes: ClienteFact[] }>(`/plataforma/facturacion-kyros/clientes-facturacion${qCli ? `?q=${encodeURIComponent(qCli)}` : ''}`) });
  const fijarCliente = (id: string, habilitada: boolean | null) => correr(`cf-${id}`, () => api.put(`/plataforma/facturacion-kyros/clientes-facturacion/${id}`, { habilitada }), () => { void clientesFact.refetch(); return 'Facturación del cliente actualizada.'; });
  const entregas = useQuery({ queryKey: ['fact-entregas'], queryFn: () => api.get<EntregasAviso>('/plataforma/facturacion-kyros/webhook/entregas'), refetchInterval: 30_000, retry: false });
  const probarEntrega = () => correr('entrega', () => api.post<{ ok: boolean; mensaje: string }>('/plataforma/facturacion-kyros/webhook/probar-entrega', {}), (r) => { void entregas.refetch(); return r.mensaje; });
  const [resRep, setResRep] = useState<{ id: string; ok: boolean; texto: string } | null>(null);
  const reprocesarEntrega = (d: { idExterno?: string | null; entregaId?: string | null; facturaId?: string | null; tipo?: string | null }) => { setResRep({ id: d.entregaId ?? '', ok: true, texto: 'Reprocesando…' }); return correr('reproc', () => api.post<{ ok: boolean; mensaje: string }>('/plataforma/facturacion-kyros/webhook/reprocesar', d), (r) => { setResRep({ id: d.entregaId ?? '', ok: r.ok, texto: r.mensaje }); void entregas.refetch(); void q.refetch(); return r.mensaje; }).catch((e) => setResRep({ id: d.entregaId ?? '', ok: false, texto: String(e?.message ?? 'No se pudo reprocesar') })); };
  const reprocesarFactura = (id: string) => { setResRep({ id, ok: true, texto: 'Reprocesando…' }); return correr(`rp-${id}`, () => api.post<{ ok: boolean; mensaje: string }>(`/plataforma/facturacion-kyros/facturas/${id}/reprocesar`, {}), (r) => { setResRep({ id, ok: r.ok, texto: r.mensaje }); void q.refetch(); return r.mensaje; }).catch((e) => setResRep({ id, ok: false, texto: String(e?.message ?? 'No se pudo reprocesar') })); };
  const verificar = () => correr('wh', () => api.post<{ ok: boolean; mensaje: string }>('/plataforma/facturacion-kyros/integracion/verificar', {}), (r) => r.mensaje);

  const t = q.data?.totales; const al = q.data?.alertas; const ig = integ.data;
  return (
    <section className="flex flex-col gap-space-md">
      <p role="note" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm font-label-md">Ambiente de pruebas / sin validez fiscal: hoy FacturaSIN opera contra un SIN simulado y Kyros-Tech S.R.L. usa un NIT ficticio. Ninguna de estas facturas es un documento tributario real.</p>
      {ig?.avisoCodigos && <p role="note" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm font-label-md"><strong>{ig.avisoCodigos.split('.')[0]}.</strong> Hoy el método de pago ({ig.config.metodoPago}) y el producto ({ig.config.codigoProducto}) son marcadores de simulación: NO CONFIRMADO — definir con el catálogo del SIN. Cámbialos abajo y marca «confirmados» cuando tu contador los valide.</p>}
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {msg && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-wrap items-center justify-between gap-space-sm">
        <div><h2 className="font-headline-sm text-headline-sm">Integración con FacturaSIN</h2>
          <p className="font-body-sm" data-testid="estado-enlace">{ig?.config.activo ? 'Activa' : 'Apagada'} · conexión con FacturaSIN: {ig?.secretoConfigurado ? 'lista' : 'falta la credencial de servicio (la coloca el despliegue una vez)'} · Aviso de estados: {ig?.webhookConfigurado ? 'activo' : 'pendiente (se activa solo)'}</p>
          <p className="font-body-sm text-on-surface-variant">{aLenguajeSimple(ig?.enlace?.mensaje ?? 'El aviso automático se activa solo en cuanto el sistema detecta su dirección pública.')}{ig?.enlace?.webhook.ultimaEntrega ? ` Última entrega: ${new Date(ig.enlace.webhook.ultimaEntrega).toLocaleString('es-BO')}.` : ''}</p></div>
        <div className="flex flex-wrap gap-space-sm"><button type="button" onClick={alternar} disabled={!!ocupado} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>{ig?.config.activo ? 'Apagar' : 'Activar'}</button>
          <button type="button" onClick={verificar} disabled={!!ocupado} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>{GLOSARIO.suscribirWebhook}</button>
          <button type="button" onClick={() => correr('conc', () => api.post<{ conciliadas: number; reintentadas: number; emitidas: number }>('/plataforma/facturacion-kyros/conciliar'), (r) => `Conciliación: ${r.conciliadas} revisadas, ${r.reintentadas} reintentadas, ${r.emitidas} emitidas.`)} disabled={!!ocupado || !ig?.lista} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>{GLOSARIO.conciliar}</button></div>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm" data-testid="clientes-facturacion">
        <h2 className="font-headline-sm text-headline-sm">Facturación por cliente</h2>
        <p className="font-body-sm text-on-surface-variant">Estándar «pago + interruptor»: el interruptor del administrador manda; sin él, la facturación se habilita sola con un plan de pago vigente (prueba y demostración: apagada).</p>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Buscar cliente</span><input value={qCli} onChange={(e) => setQCli(e.target.value)} className={clases.input} /></label>
        <ul className="flex flex-col gap-1">
          {(clientesFact.data?.clientes ?? []).map((c) => (
            <li key={c.id} data-testid="cliente-facturacion" className="flex flex-wrap items-center gap-space-sm font-body-sm"><strong>{c.nombre}</strong><span className={c.habilitada ? 'text-primary' : 'text-on-surface-variant'}>{c.etiqueta}</span>
              <select aria-label="Facturación del cliente" value={c.override === null ? 'defecto' : c.override ? 'on' : 'off'} disabled={!!ocupado} onChange={(e) => void fijarCliente(c.id, e.target.value === 'defecto' ? null : e.target.value === 'on')} className={clases.input}>
                <option value="defecto">Por defecto (según plan)</option><option value="on">Encendida</option><option value="off">Apagada</option></select></li>
          ))}
        </ul>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm" data-testid="entregas-aviso">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm">Últimos avisos recibidos</h2>
          <button type="button" onClick={probarEntrega} disabled={!!ocupado} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>Probar entrega</button>
        </div>
        <p className="font-body-sm text-on-surface-variant" data-testid="recibidas">Entregas recibidas: {entregas.data?.recibidas.total ?? 0} (con firma inválida: {entregas.data?.recibidas.firmaInvalida ?? 0}).{entregas.data?.recibidas.ultima ? ` Última: ${new Date(entregas.data.recibidas.ultima.fecha).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })} (${entregas.data.recibidas.ultima.evento}, ${entregas.data.recibidas.ultima.resultado}).` : ''}</p>
        {entregas.data?.latencia && entregas.data.latencia.ultimaMs !== null && <p className="font-body-sm text-on-surface-variant" data-testid="latencia">Tiempo de respuesta del receptor: última {entregas.data.latencia.ultimaMs} ms · máxima {entregas.data.latencia.maxMs ?? 0} ms · promedio {entregas.data.latencia.promedioMs ?? 0} ms (FacturaSIN espera hasta 10 000 ms).</p>}
        {entregas.data?.huella && !entregas.data.huella.coincide && <p role="status" className="font-body-sm text-on-surface-variant">El secreto de firma guardado no coincide con el de FacturaSIN: el sistema lo re-sincroniza solo al pulsar «Probar entrega» o «Verificar».</p>}
        {entregas.data?.error && <p role="alert" className="font-body-sm text-error">{entregas.data.error}</p>}
        {entregas.data && entregas.data.entregas.length === 0 && !entregas.data.error && <p className="font-body-sm text-on-surface-variant">FacturaSIN todavía no registra entregas del aviso para este sistema.</p>}
        <ul className="flex flex-col gap-1">
          {(entregas.data?.entregas ?? []).map((e) => (
            <li key={e.id} data-testid="entrega" className="flex flex-wrap items-center gap-space-sm font-body-sm"><strong>{e.tipo}</strong><span>{e.numero ? `N.º ${e.numero}` : (e.facturaId ?? '-')}</span><span>{e.estado}</span><span>{e.intentos} intento(s)</span><span>{e.ultimoIntentoEn ? new Date(e.ultimoIntentoEn).toLocaleString('es-BO', { timeZone: 'America/La_Paz' }) : '-'}</span><span>HTTP {e.ultimoCodigoHttp ?? '-'}</span><span>{e.registrada ? 'Registrada aquí' : 'No registrada aquí'}</span>
              {!e.registrada && <button type="button" disabled={!!ocupado} onClick={() => void reprocesarEntrega({ idExterno: e.idExterno ?? null, entregaId: e.id, facturaId: e.facturaId ?? null, tipo: e.tipo })} className="h-9 px-space-sm text-primary font-label-md">Reprocesar</button>}</li>
          ))}
        </ul>
        {resRep && <p role="status" data-testid="res-reprocesar" className={`rounded-lg p-space-sm font-label-md ${resRep.ok ? 'bg-primary-fixed text-on-surface' : 'bg-error-container text-on-error-container'}`}>{resRep.texto}</p>}
      </div>

      <details className="rounded-xl border border-outline-variant p-space-md" data-testid="avanzado">
        <summary className="cursor-pointer font-label-md font-bold">Avanzado (solo SuperAdmin de la plataforma)</summary>
        {/* GS-F1: la línea técnica de la conexión (dirección, empresa, client) vive solo aquí. */}
        <p className="mt-space-sm font-body-sm text-on-surface-variant" data-testid="linea-tecnica">{ig ? `${ig.config.url} · empresa ${ig.config.empresa} · client ${ig.config.clientId}` : '…'}</p>
        <div className="mt-space-md flex flex-col gap-space-md">
          <p className="font-body-sm text-on-surface-variant">Estos códigos fiscales son provisionales (NO CONFIRMADOS) y se completan solos. Ajústalos solo si el contador lo indica.</p>
      {ig && <CodigosFiscales ig={ig} ocupado={!!ocupado} onGuardar={(parcial) => void correr('cfg-sin', () => api.put('/plataforma/facturacion-kyros/integracion', parcial), () => 'Códigos fiscales guardados.')} />}

      <form className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid gap-space-sm sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void correr('cfg', () => api.put('/plataforma/facturacion-kyros/integracion', { metodoPago: Number(f.get('metodoPago')), codigoProducto: String(f.get('codigoProducto')).trim(), modoIva: String(f.get('modoIva')), codigosConfirmados: f.get('codigosConfirmados') === 'on' }), () => 'Códigos fiscales guardados.'); }}>
        <h3 className="font-headline-sm text-headline-sm sm:col-span-4">Códigos fiscales de la factura de Kyros-Tech</h3>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Método de pago (código SIN)</span><input name="metodoPago" type="number" min={1} max={99} defaultValue={ig?.config.metodoPago ?? 7} key={`mp${ig?.config.metodoPago}`} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Código de producto (de FacturaSIN)</span><input name="codigoProducto" defaultValue={ig?.config.codigoProducto ?? ''} key={`cp${ig?.config.codigoProducto}`} maxLength={60} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>IVA</span><select name="modoIva" defaultValue={ig?.config.modoIva ?? 'por_dentro'} key={`mi${ig?.config.modoIva}`} className={clases.input}><option value="por_dentro">Por dentro (vigente, 13 %)</option><option value="por_fuera" disabled={!ig?.ivaPorFueraVigente && ig?.config.modoIva !== 'por_fuera'}>Por fuera (Ley 1733, aún sin decreto)</option></select></label>
        <label className="flex items-center gap-space-sm"><input name="codigosConfirmados" type="checkbox" defaultChecked={ig?.config.codigosConfirmados} key={`cc${ig?.config.codigosConfirmados}`} /><span className="font-body-sm">Confirmados por el contador</span></label>
        <button type="submit" disabled={!!ocupado} className={`${clases.secundario} sm:w-auto sm:px-space-md sm:col-span-4`}>Guardar códigos</button>
      </form>
        </div>
      </details>

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
              {x.cuf && <p className="font-body-sm text-on-surface-variant break-all" data-testid="fk-cuf">{lineaCuf(x.cuf, x.emitidaEn, (f) => `Emitida el ${f}`, (i) => new Date(i).toLocaleString('es-BO', { timeZone: 'America/La_Paz' }))}</p>}
              {x.sinFactura && x.horasSinFactura >= 1 && <p className="font-body-sm text-error">Sin factura hace {x.horasSinFactura} h{x.horasSinFactura >= 24 ? ' (crítico)' : ''}.</p>}
              {x.error && <p className="font-body-sm text-error">{x.errorCodigo}: {x.error}{x.intentos ? ` (intentos: ${x.intentos})` : ''}</p>}
              {!x.error && x.errorCodigo === 'SIN_DATOS_FISCALES' && <p className="font-body-sm text-error">El cliente no tiene NIT/razón social válidos. Pídele que los cargue en Suscripción › Datos para tu factura, o emite como consumidor final.</p>}
              <div className="flex flex-wrap gap-space-xs">
                {resRep && resRep.id === x.facturaId && <span role="status" className="font-body-sm">{resRep.texto}</span>}
                {x.facturaId && !x.vistaRegistrada && ['emitida', 'en_proceso', 'observada'].includes(x.estado) && <button type="button" disabled={!!ocupado} onClick={() => void reprocesarFactura(x.facturaId!)} className="h-11 px-space-sm text-primary font-label-lg">Reprocesar</button>}
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
