import { confirmar, pedirTexto } from '../componentes/Dialogos';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos, useSesion } from '../lib/sesion';
import { bs } from '../lib/tipos';
import { SubirQr, type QrActual } from '../lib/kyros-subir-qr';
import { PlataformaDemo } from './PlataformaDemo';
import { PlataformaFacturacion } from './PlataformaFacturacion';
import { PlataformaIa } from './PlataformaIa';
import { PlataformaIntegraciones } from './PlataformaIntegraciones';
import { ListaEsqueleto } from '../componentes/Esqueleto';
import { PlataformaNav } from '../componentes/estandar/PlataformaNav';
import { SinPermiso } from '../componentes/estandar/SinPermiso';
import { VistaPreviaCambioPlan } from '../componentes/estandar/VistaPreviaCambioPlan';
import { PLATAFORMA, SECCIONES_PLATAFORMA, type SeccionPlataforma as SeccionPlataformaId } from '../lib/kyros-estandar';
import { funcionalidadesSinPrecio } from '../lib/kyros-local';

interface PagoP { id: string; sucursal: string; cuenta: string; meses: number; mesesDeRegalo: number; monto: string; esperado: string | null; coincide: boolean | null; referencia: string; banco: string | null; fechaPago: string | null; estado: string; motivo: string | null; tieneVoucher: boolean; creado: string; habilitadaHasta: string | null; promocion: string | null }
interface SucP { id: string; nombre: string; cuenta: string; estado: string; habilitadaHasta: string | null; diasRestantes: number | null; suscripcion: string; plan: string | null; planId: string | null }
interface VistaPrevia { hoy: string; habilitadaHasta: string | null; diasRestantes: number; diasNuevos: number; creditoCent: string; netoCentavos?: number; ivaCentavos?: number; totalCentavos?: number; vigenciaNueva: string | null; aplicaPrevia: boolean }
interface PlanP { id: string; codigo: string; nombre: string; precioMensual: string; activo: boolean }
interface PromoP { id: string; nombre: string; mesesRequeridos: number; mesesDeRegalo: number; descuentoPct: number; desde: string; hasta: string; activa: boolean }
/** Subpestañas de cada sección de «Plataforma» (S-04): una sola estructura con seis secciones y los mismos nombres en los 7 sistemas. */
type Sub = 'pagos' | 'sucursales' | 'planes' | 'promociones' | 'cobro' | 'integraciones' | 'ia';
const SUBPESTANAS: Partial<Record<SeccionPlataformaId, [Sub, string][]>> = {
  clientes: [['sucursales', 'Restaurantes'], ['pagos', 'Pagos por validar']],
  planes: [['planes', 'Planes'], ['promociones', 'Promociones'], ['cobro', 'Cobro']],
  integraciones: [['integraciones', 'Conexiones'], ['ia', 'Inteligencia artificial']],
};
const SECCIONES_IDS = SECCIONES_PLATAFORMA.map((x) => x.clave as string);

function Subpestanas({ seccion, children }: { seccion: SeccionPlataformaId; children: (sub: Sub) => React.ReactNode }) {
  const lista = SUBPESTANAS[seccion] ?? [];
  const [sub, setSub] = useState<Sub>(lista[0]![0]);
  return (
    <>
      <div className="flex gap-space-xs overflow-x-auto" role="tablist" aria-label="Secciones">
        {lista.map(([k, n]) => <button key={k} role="tab" aria-selected={sub === k} onClick={() => setSub(k)} className={`h-12 px-space-md rounded-lg font-semibold whitespace-nowrap ${sub === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}
      </div>
      {children(sub)}
    </>
  );
}

interface FilaAuditoria { cuando: string; accion: string; entidad: string | null; entidadId: string | null; quien: string | null; sucursal: string | null }
/** Auditoría de plataforma: lo último que quedó registrado (quién, cuándo y qué). Solo lectura. */
function Auditoria() {
  const q = useQuery({ queryKey: ['plat-auditoria'], queryFn: () => api.get<FilaAuditoria[]>('/plataforma/auditoria') });
  if (q.isLoading) return <ListaEsqueleto />;
  if (q.isError) return <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{mensajeDeError(q.error)}</p>;
  const f = q.data ?? [];
  if (!f.length) return <p className="text-on-surface-variant">Todavía no hay movimientos registrados.</p>;
  return (
    <div className="overflow-x-auto"><table className="min-w-[48rem] w-full text-body-sm"><caption className="sr-only">Últimos movimientos registrados</caption>
      <thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-2">Cuándo</th><th className="p-2">Quién</th><th className="p-2">Qué pasó</th><th className="p-2">Restaurante</th></tr></thead>
      <tbody>{f.map((x, i) => <tr key={i} className="border-t border-outline-variant"><td className="p-2 whitespace-nowrap">{new Date(x.cuando).toLocaleString('es-BO')}</td><td className="p-2">{x.quien ?? 'Sistema'}</td><td className="p-2">{x.accion}{x.entidad ? ` · ${x.entidad}` : ''}</td><td className="p-2">{x.sucursal ?? '—'}</td></tr>)}</tbody></table></div>
  );
}

/** Consola «Plataforma» de Kyros-Tech: Clientes, Planes, Facturación, Integraciones, Auditoría y Demostración (rutas /plataforma/…). */
export function Plataforma() {
  const { esPlataforma } = useRolesActivos();
  const { seccion } = useParams();
  if (!esPlataforma) return <SinPermiso aQuien="el equipo de Kyros-Tech" />;
  if (!seccion || !SECCIONES_IDS.includes(seccion)) return <Navigate to="/plataforma/clientes" replace />;
  const id = seccion as SeccionPlataformaId;
  return (
    <div className="flex flex-col gap-space-lg">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">{PLATAFORMA.nombre}</h1><p className="font-body-md text-body-md text-on-surface-variant">Consola de Kyros-Tech: clientes, planes, facturación y más de todos los restaurantes.</p></header>
      <PlataformaNav />
      {id === 'clientes' && <Subpestanas seccion={id}>{(sub) => (sub === 'pagos' ? <Pagos /> : <Sucursales />)}</Subpestanas>}
      {id === 'planes' && <Subpestanas seccion={id}>{(sub) => (sub === 'promociones' ? <Promociones /> : sub === 'cobro' ? <Cobro /> : <Planes />)}</Subpestanas>}
      {id === 'facturacion' && <PlataformaFacturacion />}
      {id === 'integraciones' && <Subpestanas seccion={id}>{(sub) => (sub === 'ia' ? <PlataformaIa /> : <PlataformaIntegraciones />)}</Subpestanas>}
      {id === 'auditoria' && <Auditoria />}
      {id === 'demostracion' && <PlataformaDemo />}
    </div>
  );
}

function Voucher({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null); const [fallo, setFallo] = useState(false);
  useEffect(() => { let u: string | null = null; api.blob(`/plataforma/pagos/${id}/voucher`).then((b) => { u = URL.createObjectURL(b); setUrl(u); }).catch(() => setFallo(true)); return () => { if (u) URL.revokeObjectURL(u); }; }, [id]);
  if (fallo) return <p className="text-on-surface-variant">Sin comprobante.</p>;
  return url ? <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="Comprobante de pago" className="max-h-72 rounded-lg border border-outline-variant object-contain" /></a> : <ListaEsqueleto />;
}

function Pagos() {
  const qc = useQueryClient();
  const [estado, setEstado] = useState<'pendiente' | 'validado' | 'rechazado'>('pendiente');
  const q = useQuery({ queryKey: ['plat-pagos', estado], queryFn: () => api.get<PagoP[]>(`/plataforma/pagos?estado=${estado}`), refetchInterval: 30_000 });
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null); const [motivo, setMotivo] = useState('');
  const refrescar = () => qc.invalidateQueries({ queryKey: ['plat-pagos'] });
  const aprobar = async (id: string) => { setError(null); if (!(await confirmar({ titulo: 'Aprobar pago', mensaje: '¿Aprobar este pago? Se habilitará la sucursal por los meses indicados.', aceptar: 'Aprobar' }))) return; try { await api.post(`/plataforma/pagos/${id}/aprobar`); await refrescar(); } catch (e) { setError(mensajeDeError(e)); } };
  const rechazar = async (id: string) => { setError(null); try { await api.post(`/plataforma/pagos/${id}/rechazar`, { motivo }); setRechazando(null); setMotivo(''); await refrescar(); } catch (e) { setError(mensajeDeError(e)); } };
  return (
    <section className="flex flex-col gap-space-sm">
      <div className="flex gap-space-xs">{(['pendiente', 'validado', 'rechazado'] as const).map((k) => <button key={k} onClick={() => setEstado(k)} aria-pressed={estado === k} className={`h-12 px-space-md rounded-lg font-semibold capitalize ${estado === k ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{k === 'validado' ? 'Aprobados' : k === 'pendiente' ? 'Pendientes' : 'Rechazados'}</button>)}</div>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {q.isLoading ? <ListaEsqueleto /> : (q.data ?? []).length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">No hay pagos {estado === 'pendiente' ? 'pendientes' : estado === 'validado' ? 'aprobados' : 'rechazados'}.</p> : (
        <ul className="grid grid-cols-1 gap-gutter xl:grid-cols-2">{q.data!.map((x) => (
          <li key={x.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
            <div className="flex flex-wrap items-start justify-between gap-space-sm"><div><h2 className="font-headline-sm text-headline-sm">{x.sucursal}</h2><p className="font-body-sm text-on-surface-variant">{x.cuenta} · {new Date(x.creado).toLocaleString('es-BO')}</p></div>
              <span className="font-headline-md text-headline-md text-primary font-label-lg">{bs(x.monto)}</span></div>
            <dl className="grid grid-cols-2 gap-x-space-md gap-y-1 font-body-sm"><dt className="text-on-surface-variant">Meses</dt><dd>{x.meses}{x.mesesDeRegalo ? ` + ${x.mesesDeRegalo} de regalo (${x.promocion})` : ''}</dd><dt className="text-on-surface-variant">Referencia</dt><dd className="font-label-md">{x.referencia}</dd><dt className="text-on-surface-variant">Banco / fecha</dt><dd>{x.banco ?? '—'} · {x.fechaPago ?? '—'}</dd><dt className="text-on-surface-variant">Habilitada hasta</dt><dd>{x.habilitadaHasta ?? '—'}</dd>
              <dt className="text-on-surface-variant">Monto esperado</dt><dd className={x.coincide === false ? 'text-error font-semibold' : ''}>{x.esperado ? bs(x.esperado) : 'Sin plan asignado'}{x.coincide === false ? ' · NO coincide' : x.coincide ? ' · coincide' : ''}</dd></dl>
            {x.tieneVoucher ? <Voucher id={x.id} /> : <p className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm">El restaurante todavía no subió el comprobante.</p>}
            {x.motivo && <p className="text-error font-body-sm">Motivo del rechazo: {x.motivo}</p>}
            {x.estado === 'pendiente' && (rechazando === x.id ? (
              <div className="flex flex-col gap-space-xs"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Motivo (obligatorio)</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} className={clases.input} autoFocus /></label>
                <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={() => setRechazando(null)} className="h-12 rounded-lg border border-outline-variant font-semibold">Cancelar</button><button type="button" disabled={motivo.trim().length < 3} onClick={() => rechazar(x.id)} className="h-12 rounded-lg bg-error text-on-error font-semibold disabled:opacity-50">Rechazar</button></div></div>
            ) : (
              <div className="grid grid-cols-2 gap-space-sm"><button type="button" disabled={!x.tieneVoucher} onClick={() => aprobar(x.id)} className="h-12 rounded-lg bg-tertiary-container text-white font-semibold disabled:opacity-50">Aprobar</button><button type="button" onClick={() => setRechazando(x.id)} className="h-12 rounded-lg border border-error text-error font-semibold">Rechazar…</button></div>
            ))}
          </li>))}</ul>
      )}
    </section>
  );
}

function Sucursales() {
  const qc = useQueryClient();
  const { entrarSoporte } = useSesion(); const nav = useNavigate();
  const entrar = async (id: string, nombre: string) => { setError(null); try { await api.post('/plataforma/soporte/entrar', { sucursalId: id }); entrarSoporte(id, nombre); nav('/app/panel'); } catch (e) { setError(mensajeDeError(e)); } };
  const q = useQuery({ queryKey: ['plat-sucursales'], queryFn: () => api.get<SucP[]>('/plataforma/sucursales') });
  const planes = useQuery({ queryKey: ['plat-planes'], queryFn: () => api.get<PlanP[]>('/plataforma/planes') });
  const [error, setError] = useState<string | null>(null);
  const ajustar = async (id: string, cambios: object, pregunta: string) => {
    const motivo = await pedirTexto({ titulo: pregunta, mensaje: 'Queda registrado con tu nombre.', etiqueta: 'Motivo', minimo: 3 }); if (!motivo || motivo.trim().length < 3) return;
    setError(null); try { await api.patch(`/plataforma/sucursales/${id}`, { ...cambios, motivo: motivo.trim() }); await qc.invalidateQueries({ queryKey: ['plat-sucursales'] }); } catch (e) { setError(mensajeDeError(e)); }
  };
  // S-06: antes de cambiar el plan se muestra la vista previa (días, fecha efectiva, crédito) con la misma regla que aplica el servidor.
  const [previa, setPrevia] = useState<{ id: string; nombre: string; planId: string | null; datos: VistaPrevia | null } | null>(null);
  const previaPlan = async (id: string, nombre: string, planId: string | null) => {
    setError(null);
    if (!planId) { setPrevia({ id, nombre, planId, datos: null }); return; }
    try { setPrevia({ id, nombre, planId, datos: await api.get<VistaPrevia>(`/plataforma/sucursales/${id}/cambio-plan?planId=${planId}`) }); } catch (e) { setError(mensajeDeError(e)); }
  };
  const color: Record<string, string> = { activa: 'text-tertiary', por_vencer: 'text-secondary', gracia: 'text-secondary', vencida: 'text-error' };
  return (
    <section className="flex flex-col gap-space-sm">
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {previa && (
        <div className="flex flex-col gap-space-sm rounded-xl border border-outline-variant p-space-sm">
          <p className="font-semibold">Cambiar el plan de {previa.nombre}</p>
          {previa.datos?.aplicaPrevia ? <VistaPreviaCambioPlan datos={{ fechaEfectiva: previa.datos.hoy, vigenciaNueva: previa.datos.vigenciaNueva, diasRestantes: previa.datos.diasRestantes, diasExtra: Math.max(0, previa.datos.diasNuevos - previa.datos.diasRestantes), creditoSobranteCentavos: Number(previa.datos.totalCentavos ?? 0) }} nota={`Se conserva el valor ya pagado: los ${previa.datos.diasRestantes} días que quedan equivalen a ${previa.datos.diasNuevos} días del plan nuevo.`} /> : <p className="text-on-surface-variant">El plan nuevo rige desde hoy; no hay días pagados por convertir.</p>}
          <div className="flex gap-space-xs">
            <button type="button" className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold" onClick={async () => { const x = previa; setPrevia(null); await ajustar(x.id, { planId: x.planId }, `Cambiar el plan de ${x.nombre}.`); }}>Confirmar cambio</button>
            <button type="button" className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold" onClick={() => setPrevia(null)}>Cancelar</button>
          </div>
        </div>)}
      {q.isLoading ? <ListaEsqueleto /> : (
        <div className="overflow-x-auto"><table className="min-w-[48rem] w-full text-body-sm"><caption className="sr-only">Sucursales de todos los restaurantes</caption>
          <thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-2">Sucursal</th><th className="p-2">Cuenta</th><th className="p-2">Plan</th><th className="p-2">Habilitada hasta</th><th className="p-2">Estado</th><th className="p-2" /></tr></thead>
          <tbody>{(q.data ?? []).map((s) => (
            <tr key={s.id} className="border-t border-outline-variant align-middle">
              <td className="p-2 font-semibold">{s.nombre}<button type="button" onClick={() => entrar(s.id, s.nombre)} className="block mt-1 h-12 px-space-sm rounded-lg border border-outline-variant text-primary font-label-md">Entrar en modo soporte</button></td><td className="p-2">{s.cuenta}</td>
              <td className="p-2"><select aria-label={`Plan de ${s.nombre}`} value={s.planId ?? ''} onChange={(e) => void previaPlan(s.id, s.nombre, e.target.value || null)} className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm"><option value="">Sin plan</option>{(planes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre} · {bs(p.precioMensual)}</option>)}</select></td>
              <td className="p-2 font-label-md">{s.habilitadaHasta ?? '—'}</td>
              <td className={`p-2 font-semibold ${color[s.suscripcion]}`}>{s.estado !== 'activo' ? s.estado : s.suscripcion.replace('_', ' ')}</td>
              <td className="p-2">{s.estado === 'activo' ? <button type="button" onClick={() => ajustar(s.id, { estado: 'suspendido' }, `Suspender ${s.nombre}.`)} className="h-12 px-space-sm rounded-lg border border-error text-error">Suspender</button> : <button type="button" onClick={() => ajustar(s.id, { estado: 'activo' }, `Reactivar ${s.nombre}.`)} className="h-12 px-space-sm rounded-lg border border-outline-variant text-primary">Reactivar</button>}</td>
            </tr>))}</tbody></table></div>
      )}
    </section>
  );
}

function Planes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plat-planes'], queryFn: () => api.get<PlanP[]>('/plataforma/planes') });
  const [error, setError] = useState<string | null>(null);
  const crear = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); const form = e.currentTarget; try { await api.post('/plataforma/planes', { codigo: String(f.get('codigo')).trim(), nombre: String(f.get('nombre')).trim(), precioMensual: Number(String(f.get('precio')).replace(',', '.')) }); form.reset(); await qc.invalidateQueries({ queryKey: ['plat-planes'] }); } catch (err) { setError(mensajeDeError(err)); } };
  return (
    <section className="flex flex-col gap-space-md">
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <form onSubmit={crear} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-1 gap-space-sm sm:grid-cols-4 items-end">
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Código</span><input name="codigo" required maxLength={20} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Nombre</span><input name="nombre" required className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Precio mensual (Bs)</span><input name="precio" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" className={`${clases.input} font-label-lg`} /></label>
        <button className={clases.primario}>Crear plan</button>
      </form>
      {(() => { const pend = funcionalidadesSinPrecio((q.data ?? []).map((p) => ({ nombre: p.nombre, precio: p.precioMensual })), true); return pend.length ? <p role="status" data-testid="sin-precio" className="rounded-lg bg-surface-container p-space-sm"><strong>Pendientes de precio (solo lo ves tú):</strong> {pend.join(', ')}</p> : null; })()}
      <ul className="grid grid-cols-1 gap-gutter sm:grid-cols-3">{(q.data ?? []).map((p) => <li key={p.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><p className={clases.etiqueta}>{p.codigo}</p><p className="font-headline-sm text-headline-sm">{p.nombre}</p><p className="font-label-lg text-primary">{bs(p.precioMensual)} / mes</p></li>)}</ul>
    </section>
  );
}

function Promociones() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plat-promos'], queryFn: () => api.get<PromoP[]>('/plataforma/promociones') });
  const [error, setError] = useState<string | null>(null);
  const crear = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); const form = e.currentTarget;
    try { await api.post('/plataforma/promociones', { nombre: String(f.get('nombre')).trim(), mesesRequeridos: Number(f.get('meses')), mesesDeRegalo: Number(f.get('regalo') || 0), descuentoPct: Number(f.get('descuento') || 0), desde: String(f.get('desde')), hasta: String(f.get('hasta')) }); form.reset(); await qc.invalidateQueries({ queryKey: ['plat-promos'] }); } catch (err) { setError(mensajeDeError(err)); }
  };
  const alternar = async (p: PromoP) => { try { await api.patch(`/plataforma/promociones/${p.id}`, { nombre: p.nombre, mesesRequeridos: p.mesesRequeridos, mesesDeRegalo: p.mesesDeRegalo, descuentoPct: p.descuentoPct, desde: p.desde, hasta: p.hasta, activa: !p.activa }); await qc.invalidateQueries({ queryKey: ['plat-promos'] }); } catch (err) { setError(mensajeDeError(err)); } };
  return (
    <section className="flex flex-col gap-space-md">
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <form onSubmit={crear} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-2 gap-space-sm sm:grid-cols-3 lg:grid-cols-6 items-end">
        <label className="flex flex-col gap-space-xs col-span-2 lg:col-span-2"><span className={clases.etiqueta}>Nombre</span><input name="nombre" required className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Desde (meses)</span><input name="meses" type="number" min={1} max={24} required defaultValue={3} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Meses de regalo</span><input name="regalo" type="number" min={0} max={24} defaultValue={0} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Descuento %</span><input name="descuento" type="number" min={0} max={100} step="0.01" defaultValue={0} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Vigente desde</span><input name="desde" type="date" required className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Hasta</span><input name="hasta" type="date" required className={clases.input} /></label>
        <button className={`${clases.primario} col-span-2 sm:col-span-1`}>Crear</button>
      </form>
      <ul className="flex flex-col gap-space-xs">{(q.data ?? []).map((p) => (
        <li key={p.id} className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-wrap items-center justify-between gap-space-sm ${p.activa ? '' : 'opacity-60'}`}>
          <div><p className="font-body-md font-semibold">{p.nombre}</p><p className="font-body-sm text-on-surface-variant">Desde {p.mesesRequeridos} meses · {p.mesesDeRegalo ? `+${p.mesesDeRegalo} de regalo` : 'sin regalo'} · {p.descuentoPct}% · {p.desde} a {p.hasta}</p></div>
          <button type="button" onClick={() => alternar(p)} className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold">{p.activa ? 'Desactivar' : 'Activar'}</button>
        </li>))}</ul>
    </section>
  );
}

function Cobro() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plat-cobro'], queryFn: () => api.get<{ instrucciones: string; tieneQr: boolean }>('/plataforma/cobro') });
  const qrq = useQuery({ queryKey: ['qr-plataforma'], queryFn: () => api.get<QrActual>('/qr-cobro/plataforma') });
  const [msg, setMsg] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const guardar = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(null); setMsg(null); const f = new FormData(e.currentTarget); try { await api.put('/plataforma/cobro', { instrucciones: String(f.get('instrucciones')).trim() }); setMsg('Instrucciones guardadas.'); } catch (err) { setError(mensajeDeError(err)); } };
  return (
    <section className="grid grid-cols-1 gap-gutter md:grid-cols-2 max-w-4xl">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md">
        <SubirQr qr={qrq.data} idioma="es" puedeEditar subir={(f, banco) => api.subirQr('/qr-cobro/plataforma', f, banco)} quitar={() => api.del('/qr-cobro/plataforma')} alCambiar={() => { void qc.invalidateQueries({ queryKey: ['qr-plataforma'] }); void qc.invalidateQueries({ queryKey: ['plat-cobro'] }); }} descripcion="Es el QR con el que los restaurantes pagan su suscripción." />
      </div>
      <form onSubmit={guardar} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm">Instrucciones de pago</h2>
        <textarea name="instrucciones" rows={6} maxLength={1000} defaultValue={q.data?.instrucciones ?? ''} key={q.data?.instrucciones ?? 'nuevo'} className={`${clases.input} h-auto py-space-sm`} placeholder="Ej.: Paga al QR, guarda el comprobante y súbelo en «Suscripción»." />
        <button className={clases.primario}>Guardar</button>
      </form>
      {error && <p role="alert" className="md:col-span-2 rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {msg && <p role="status" className="md:col-span-2 rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}
    </section>
  );
}
