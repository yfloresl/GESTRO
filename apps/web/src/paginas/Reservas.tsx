import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';

interface Reserva { id: string; codigo: string; cliente: string; telefono: string | null; personas: number; estado: 'pendiente' | 'confirmada' | 'sentada' | 'cumplida' | 'no_show' | 'cancelada'; notas: string | null; origen: string; mesa: string | null; mesaId: string | null; hora: string; hasta: string }
interface Mesa { id: string; numero: string; asientos: number; activa?: boolean }
interface Ajustes { habilitadas: boolean; duracionMin: number; abre: string; cierra: string; autoConfirmar: boolean; maxPersonas: number }

const ESTADO: Record<Reserva['estado'], { t: string; c: string }> = {
  pendiente: { t: 'Por confirmar', c: 'bg-secondary-fixed text-on-secondary-fixed-variant' }, confirmada: { t: 'Confirmada', c: 'bg-primary-fixed text-on-primary-fixed-variant' },
  sentada: { t: 'En la mesa', c: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' }, cumplida: { t: 'Cumplida', c: 'bg-surface-container text-on-surface-variant' },
  no_show: { t: 'No llegó', c: 'bg-error-container text-on-error-container' }, cancelada: { t: 'Cancelada', c: 'bg-surface-container text-on-surface-variant' },
};
const hoy = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
const mover = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(',', '.'));

/** Reservas (pantalla 5.4): agenda del día, confirmación, mesa asignada y ajustes de la web pública. */
export function Reservas() {
  const { sucursalId, esAdmin } = useRolesActivos();
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(hoy()); const [nueva, setNueva] = useState(false); const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['reservas', sucursalId, fecha], queryFn: () => api.get<Reserva[]>(`/reservas?fecha=${fecha}`, sucursalId!), enabled: !!sucursalId });
  const mesas = useQuery({ queryKey: ['mesas', sucursalId], queryFn: () => api.get<Mesa[]>('/mesas', sucursalId!), enabled: !!sucursalId });
  if (!sucursalId) return null;
  const refrescar = () => { void qc.invalidateQueries({ queryKey: ['reservas'] }); };
  const accion = async (r: Reserva, a: string, mesaId?: string) => {
    setError(null);
    if (a === 'cancelar' && !confirm(`¿Cancelar la reserva de ${r.cliente}?`)) return;
    try { await api.post(`/reservas/${r.id}/estado`, { accion: a, ...(mesaId ? { mesaId } : {}) }, sucursalId); refrescar(); } catch (e) { setError(mensajeDeError(e)); }
  };
  const cambiarMesa = async (r: Reserva, mesaId: string) => { setError(null); try { await api.patch(`/reservas/${r.id}/mesa`, { mesaId: mesaId || null }, sucursalId); refrescar(); } catch (e) { setError(mensajeDeError(e)); } };
  const lista = q.data ?? []; const activas = lista.filter((r) => ['pendiente', 'confirmada', 'sentada'].includes(r.estado));
  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-end justify-between gap-space-sm"><div><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Reservas</h1><p className="font-body-md text-body-md text-on-surface-variant">{activas.length} activa(s) · {activas.reduce((t, r) => t + r.personas, 0)} personas el {fecha}</p></div>
        <button type="button" onClick={() => setNueva(true)} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">add_circle</span>Nueva reserva</button></header>
      <div className="flex flex-wrap items-center gap-space-xs">
        <button type="button" aria-label="Día anterior" onClick={() => setFecha(mover(fecha, -1))} className="w-12 h-12 rounded-lg bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">chevron_left</span></button>
        <input type="date" aria-label="Fecha" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} className={`${clases.input} !w-auto`} />
        <button type="button" aria-label="Día siguiente" onClick={() => setFecha(mover(fecha, 1))} className="w-12 h-12 rounded-lg bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>
        <button type="button" onClick={() => setFecha(hoy())} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold">Hoy</button></div>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {q.isLoading ? <p role="status">Cargando…</p> : lista.length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">No hay reservas para este día.</p> : (
        <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">{lista.map((r) => {
          const viva = ['pendiente', 'confirmada', 'sentada'].includes(r.estado);
          return (
            <li key={r.id} className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-xs ${viva ? '' : 'opacity-60'}`}>
              <div className="flex items-center justify-between gap-space-sm"><span className="font-headline-sm text-headline-sm">{r.hora}<span className="font-body-sm text-on-surface-variant"> – {r.hasta}</span></span><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase whitespace-nowrap ${ESTADO[r.estado].c}`}>{ESTADO[r.estado].t}</span></div>
              <p className="font-semibold">{r.cliente} · {r.personas} pers.</p>
              <p className="font-body-sm text-on-surface-variant">{r.telefono ?? 'Sin teléfono'} · {r.origen === 'web' ? 'Web' : 'Personal'} · código {r.codigo.slice(0, 3)}-{r.codigo.slice(3)}</p>
              {r.notas && <p className="font-body-sm italic">«{r.notas}»</p>}
              {viva && <label className="flex items-center gap-space-xs"><span className={clases.etiqueta}>Mesa</span>
                <select aria-label={`Mesa de ${r.cliente}`} value={r.mesaId ?? ''} onChange={(e) => cambiarMesa(r, e.target.value)} className="h-12 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm"><option value="">Sin mesa</option>{(mesas.data ?? []).filter((m) => m.activa !== false).map((m) => <option key={m.id} value={m.id}>Mesa {m.numero} ({m.asientos})</option>)}</select></label>}
              <div className="flex flex-wrap gap-space-xs">
                {r.estado === 'pendiente' && <button type="button" onClick={() => accion(r, 'confirmar')} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold">Confirmar</button>}
                {['pendiente', 'confirmada'].includes(r.estado) && <button type="button" onClick={() => accion(r, 'sentar')} className="h-12 px-space-md rounded-lg bg-primary-container text-on-primary font-semibold">Sentar</button>}
                {r.estado === 'sentada' && <button type="button" onClick={() => accion(r, 'cumplir')} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold">Terminó</button>}
                {['pendiente', 'confirmada'].includes(r.estado) && <><button type="button" onClick={() => accion(r, 'no_show')} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold">No llegó</button>
                  <button type="button" onClick={() => accion(r, 'cancelar')} className="h-12 px-space-md rounded-lg border border-error text-error font-semibold">Cancelar</button></>}
              </div>
            </li>);
        })}</ul>)}
      {esAdmin && <AjustesWeb />}
      {nueva && <NuevaReserva fecha={fecha} cerrar={() => setNueva(false)} hecho={() => { setNueva(false); refrescar(); }} />}
    </div>
  );
}

function NuevaReserva({ fecha, cerrar, hecho }: { fecha: string; cerrar(): void; hecho(): void }) {
  const { sucursalId } = useRolesActivos();
  const mesas = useQuery({ queryKey: ['mesas', sucursalId], queryFn: () => api.get<Mesa[]>('/mesas', sucursalId!), enabled: !!sucursalId });
  const [error, setError] = useState<string | null>(null);
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim();
    try { await api.post('/reservas', { cliente: s('cliente'), telefono: s('telefono') || undefined, personas: num(f.get('personas')), fecha: s('fecha'), hora: s('hora'), mesaId: s('mesa') || undefined, notas: s('notas') || undefined }, sucursalId!); hecho(); } catch (err) { setError(mensajeDeError(err)); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Nueva reserva" className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <form onSubmit={enviar} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">Nueva reserva</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Nombre</span><input name="cliente" required minLength={2} maxLength={120} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Teléfono</span><input name="telefono" inputMode="tel" minLength={6} className={clases.input} /></label>
        <div className="grid grid-cols-3 gap-space-sm">
          <label className="flex flex-col gap-space-xs col-span-3 sm:col-span-1"><span className={clases.etiqueta}>Fecha</span><input name="fecha" type="date" required defaultValue={fecha} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Hora</span><input name="hora" type="time" step={900} required defaultValue="13:00" className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Personas</span><input name="personas" type="number" min={1} max={100} required defaultValue={2} className={clases.input} /></label></div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Mesa (opcional: si no, se asigna sola)</span><select name="mesa" className={clases.input}><option value="">Asignar automáticamente</option>{(mesas.data ?? []).filter((m) => m.activa !== false).map((m) => <option key={m.id} value={m.id}>Mesa {m.numero} ({m.asientos} asientos)</option>)}</select></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Notas (opcional)</span><input name="notas" maxLength={300} className={clases.input} /></label>
        {error && <p role="alert" className="text-error">{error}</p>}<button className={clases.primario}>Guardar reserva</button>
      </form>
    </div>
  );
}

function AjustesWeb() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient(); const [error, setError] = useState<string | null>(null); const [copiado, setCopiado] = useState(false);
  const q = useQuery({ queryKey: ['reservas-ajustes', sucursalId], queryFn: () => api.get<Ajustes>('/reservas/ajustes', sucursalId!), enabled: !!sucursalId });
  const suc = useQuery({ queryKey: ['sucursal', sucursalId], queryFn: () => api.get<{ slug: string }>('/sucursal', sucursalId!), enabled: !!sucursalId });
  const guardar = async (c: Partial<Ajustes>) => { setError(null); try { await api.put('/reservas/ajustes', c, sucursalId!); await qc.invalidateQueries({ queryKey: ['reservas-ajustes'] }); } catch (e) { setError(mensajeDeError(e)); } };
  const a = q.data; if (!a) return null;
  const enlace = suc.data ? `${window.location.origin}/r/${suc.data.slug}` : null;
  const horario = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); void guardar({ abre: String(f.get('abre')), cierra: String(f.get('cierra')), duracionMin: num(f.get('dur')), maxPersonas: num(f.get('max')) }); };
  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
      <h2 className="font-headline-sm text-headline-sm">Reservas por la web</h2>
      {error && <p role="alert" className="text-error">{error}</p>}
      <label className="flex items-center gap-space-sm min-h-12"><input type="checkbox" className="w-6 h-6" checked={a.habilitadas} onChange={(e) => guardar({ habilitadas: e.target.checked })} /><span>Recibir reservas desde la web del restaurante</span></label>
      <label className="flex items-center gap-space-sm min-h-12"><input type="checkbox" className="w-6 h-6" checked={a.autoConfirmar} onChange={(e) => guardar({ autoConfirmar: e.target.checked })} /><span>Confirmarlas automáticamente (si no, quedan «por confirmar»)</span></label>
      <form onSubmit={horario} key={`${a.abre}${a.cierra}${a.duracionMin}${a.maxPersonas}`} className="grid grid-cols-2 gap-space-sm md:grid-cols-5 items-end">
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Abre</span><input name="abre" type="time" defaultValue={a.abre} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Cierra</span><input name="cierra" type="time" defaultValue={a.cierra} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Duración (min)</span><input name="dur" type="number" min={30} max={360} step={15} defaultValue={a.duracionMin} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Máx. personas</span><input name="max" type="number" min={1} max={100} defaultValue={a.maxPersonas} className={clases.input} /></label>
        <button className="h-[52px] rounded-lg border border-outline-variant font-semibold">Guardar</button></form>
      {enlace && a.habilitadas && <div className="rounded-lg bg-surface-container p-space-sm flex flex-wrap items-center justify-between gap-space-sm"><span className="break-all font-label-md">{enlace}</span>
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(enlace).then(() => setCopiado(true)); }} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold">{copiado ? 'Copiado' : 'Copiar enlace'}</button></div>}
    </section>
  );
}
