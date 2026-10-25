import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';
import { reducirImagen } from '../lib/imagen';

interface PagoP { id: string; sucursal: string; cuenta: string; meses: number; mesesDeRegalo: number; monto: string; esperado: string | null; coincide: boolean | null; referencia: string; banco: string | null; fechaPago: string | null; estado: string; motivo: string | null; tieneVoucher: boolean; creado: string; habilitadaHasta: string | null; promocion: string | null }
interface SucP { id: string; nombre: string; cuenta: string; estado: string; habilitadaHasta: string | null; diasRestantes: number | null; suscripcion: string; plan: string | null; planId: string | null }
interface PlanP { id: string; codigo: string; nombre: string; precioMensual: string; activo: boolean }
interface PromoP { id: string; nombre: string; mesesRequeridos: number; mesesDeRegalo: number; descuentoPct: number; desde: string; hasta: string; activa: boolean }
type Pestana = 'pagos' | 'sucursales' | 'planes' | 'promociones' | 'cobro';
const PESTANAS: [Pestana, string][] = [['pagos', 'Pagos'], ['sucursales', 'Sucursales'], ['planes', 'Planes'], ['promociones', 'Promociones'], ['cobro', 'Cobro']];

/** Consola de Kyros-Tech: valida los pagos a mano (la IA nunca aprueba) y administra planes, promociones y cobro. */
export function Plataforma() {
  const { esPlataforma } = useRolesActivos();
  const [p, setP] = useState<Pestana>('pagos');
  if (!esPlataforma) return <Navigate to="/app" replace />;
  return (
    <div className="flex flex-col gap-space-lg">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Plataforma</h1><p className="font-body-md text-body-md text-on-surface-variant">Consola de Kyros-Tech: pagos, planes y sucursales de todos los restaurantes.</p></header>
      <div className="flex gap-space-xs overflow-x-auto" role="tablist" aria-label="Secciones">
        {PESTANAS.map(([k, n]) => <button key={k} role="tab" aria-selected={p === k} onClick={() => setP(k)} className={`h-12 px-space-md rounded-lg font-semibold whitespace-nowrap ${p === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}
      </div>
      {p === 'pagos' && <Pagos />}{p === 'sucursales' && <Sucursales />}{p === 'planes' && <Planes />}{p === 'promociones' && <Promociones />}{p === 'cobro' && <Cobro />}
    </div>
  );
}

function Voucher({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null); const [fallo, setFallo] = useState(false);
  useEffect(() => { let u: string | null = null; api.blob(`/plataforma/pagos/${id}/voucher`).then((b) => { u = URL.createObjectURL(b); setUrl(u); }).catch(() => setFallo(true)); return () => { if (u) URL.revokeObjectURL(u); }; }, [id]);
  if (fallo) return <p className="text-on-surface-variant">Sin comprobante.</p>;
  return url ? <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="Comprobante de pago" className="max-h-72 rounded-lg border border-outline-variant object-contain" /></a> : <p role="status">Cargando comprobante…</p>;
}

function Pagos() {
  const qc = useQueryClient();
  const [estado, setEstado] = useState<'pendiente' | 'validado' | 'rechazado'>('pendiente');
  const q = useQuery({ queryKey: ['plat-pagos', estado], queryFn: () => api.get<PagoP[]>(`/plataforma/pagos?estado=${estado}`), refetchInterval: 30_000 });
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null); const [motivo, setMotivo] = useState('');
  const refrescar = () => qc.invalidateQueries({ queryKey: ['plat-pagos'] });
  const aprobar = async (id: string) => { setError(null); if (!confirm('¿Aprobar este pago? Se habilitará la sucursal por los meses indicados.')) return; try { await api.post(`/plataforma/pagos/${id}/aprobar`); await refrescar(); } catch (e) { setError(mensajeDeError(e)); } };
  const rechazar = async (id: string) => { setError(null); try { await api.post(`/plataforma/pagos/${id}/rechazar`, { motivo }); setRechazando(null); setMotivo(''); await refrescar(); } catch (e) { setError(mensajeDeError(e)); } };
  return (
    <section className="flex flex-col gap-space-sm">
      <div className="flex gap-space-xs">{(['pendiente', 'validado', 'rechazado'] as const).map((k) => <button key={k} onClick={() => setEstado(k)} aria-pressed={estado === k} className={`h-12 px-space-md rounded-lg font-semibold capitalize ${estado === k ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{k === 'validado' ? 'Aprobados' : k === 'pendiente' ? 'Pendientes' : 'Rechazados'}</button>)}</div>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {q.isLoading ? <p role="status">Cargando…</p> : (q.data ?? []).length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">No hay pagos {estado === 'pendiente' ? 'pendientes' : estado === 'validado' ? 'aprobados' : 'rechazados'}.</p> : (
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
  const q = useQuery({ queryKey: ['plat-sucursales'], queryFn: () => api.get<SucP[]>('/plataforma/sucursales') });
  const planes = useQuery({ queryKey: ['plat-planes'], queryFn: () => api.get<PlanP[]>('/plataforma/planes') });
  const [error, setError] = useState<string | null>(null);
  const ajustar = async (id: string, cambios: object, pregunta: string) => {
    const motivo = prompt(`${pregunta}\nEscribe el motivo (queda registrado):`); if (!motivo || motivo.trim().length < 3) return;
    setError(null); try { await api.patch(`/plataforma/sucursales/${id}`, { ...cambios, motivo: motivo.trim() }); await qc.invalidateQueries({ queryKey: ['plat-sucursales'] }); } catch (e) { setError(mensajeDeError(e)); }
  };
  const color: Record<string, string> = { activa: 'text-tertiary', por_vencer: 'text-secondary', gracia: 'text-secondary', vencida: 'text-error' };
  return (
    <section className="flex flex-col gap-space-sm">
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {q.isLoading ? <p role="status">Cargando…</p> : (
        <div className="overflow-x-auto"><table className="min-w-[48rem] w-full text-body-sm"><caption className="sr-only">Sucursales de todos los restaurantes</caption>
          <thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-2">Sucursal</th><th className="p-2">Cuenta</th><th className="p-2">Plan</th><th className="p-2">Habilitada hasta</th><th className="p-2">Estado</th><th className="p-2" /></tr></thead>
          <tbody>{(q.data ?? []).map((s) => (
            <tr key={s.id} className="border-t border-outline-variant align-middle">
              <td className="p-2 font-semibold">{s.nombre}</td><td className="p-2">{s.cuenta}</td>
              <td className="p-2"><select aria-label={`Plan de ${s.nombre}`} value={s.planId ?? ''} onChange={(e) => ajustar(s.id, { planId: e.target.value || null }, `Cambiar el plan de ${s.nombre}.`)} className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm"><option value="">Sin plan</option>{(planes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre} · {bs(p.precioMensual)}</option>)}</select></td>
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
  const [qr, setQr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!q.data?.tieneQr) return; let u: string | null = null; api.blob('/plataforma/cobro/qr').then((b) => { u = URL.createObjectURL(b); setQr(u); }).catch(() => undefined); return () => { if (u) URL.revokeObjectURL(u); }; }, [q.data?.tieneQr]);
  const guardar = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(null); setMsg(null); const f = new FormData(e.currentTarget); try { await api.put('/plataforma/cobro', { instrucciones: String(f.get('instrucciones')).trim() }); setMsg('Instrucciones guardadas.'); } catch (err) { setError(mensajeDeError(err)); } };
  const subir = async (archivo: File | undefined) => { if (!archivo) return; setError(null); setMsg(null); try { await api.subirImagen('/plataforma/cobro/qr', await reducirImagen(archivo, 1200), ''); setMsg('QR actualizado.'); setQr(null); await qc.invalidateQueries({ queryKey: ['plat-cobro'] }); } catch (err) { setError(mensajeDeError(err)); } };
  return (
    <section className="grid grid-cols-1 gap-gutter md:grid-cols-2 max-w-4xl">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm items-center">
        <h2 className="font-headline-sm text-headline-sm self-start">QR de cobro</h2>
        {qr ? <img src={qr} alt="QR de cobro actual" className="w-48 h-48 object-contain" /> : <p className="text-on-surface-variant">Todavía no cargaste un QR.</p>}
        <label className="flex flex-col gap-space-xs w-full"><span className={clases.etiqueta}>Subir QR (JPG, PNG o WebP)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => subir(e.target.files?.[0])} className="font-body-sm" /></label>
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
