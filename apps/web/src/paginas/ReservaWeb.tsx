import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Cargando, clases, Marca } from '../componentes/Marca';
import { api, mensajeDeError } from '../lib/sesion';

interface Info { restaurante: string; habilitadas: boolean; duracionMin: number; abre: string; cierra: string; maxPersonas: number; confirmaSola: boolean }
interface Disp { horas: string[]; duracionMin: number }
interface Hecha { codigo: string; estado: 'pendiente' | 'confirmada'; restaurante: string; fecha: string; hora: string; personas: number; duracionMin: number }

const hoy = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);

/** Reserva de mesa desde la web del restaurante (/r/:slug): sin cuenta, con código para cancelar. */
export function ReservaWeb() {
  const { slug = '' } = useParams();
  const info = useQuery({ queryKey: ['reserva-info', slug], queryFn: () => api.get<Info>(`/public/${slug}/reservas`), retry: false });
  const [fecha, setFecha] = useState(hoy()); const [personas, setPersonas] = useState(2); const [hora, setHora] = useState('');
  const [hecha, setHecha] = useState<Hecha | null>(null); const [error, setError] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false); const [cancelada, setCancelada] = useState(false);
  const disp = useQuery({ queryKey: ['reserva-disp', slug, fecha, personas], queryFn: () => api.get<Disp>(`/public/${slug}/reservas/disponibilidad?fecha=${fecha}&personas=${personas}`), enabled: !!info.data?.habilitadas && personas >= 1, retry: false });
  const envolver = (hijo: React.ReactNode) => (
    <main className="min-h-screen bg-background px-margin py-space-lg flex justify-center"><div className="w-full max-w-md flex flex-col gap-space-md"><Marca />{hijo}</div></main>
  );
  if (info.isLoading) return <Cargando />;
  if (info.isError || !info.data) return envolver(<p role="alert" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md">No encontramos este restaurante.</p>);
  if (!info.data.habilitadas) return envolver(<section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md"><h1 className="font-headline-md text-headline-md text-primary">{info.data.restaurante}</h1><p className="text-on-surface-variant">Por ahora no recibimos reservas por internet. Llámanos para reservar tu mesa.</p></section>);

  const reservar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null);
    if (!hora) { setError('Elige una hora.'); return; }
    setOcupado(true); const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim();
    try { setHecha(await api.post<Hecha>(`/public/${slug}/reservas`, { cliente: s('cliente'), telefono: s('telefono'), email: s('email') || undefined, personas, fecha, hora, notas: s('notas') || undefined })); }
    catch (err) { setError(mensajeDeError(err)); void disp.refetch(); } finally { setOcupado(false); }
  };
  const cancelar = async () => {
    if (!hecha || !confirm('¿Cancelar tu reserva?')) return;
    try { await api.post(`/public/${slug}/reservas/cancelar`, { codigo: hecha.codigo }); setCancelada(true); } catch (err) { setError(mensajeDeError(err)); }
  };

  if (hecha) return envolver(
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-lg flex flex-col gap-space-sm" aria-live="polite">
      <span className="material-symbols-outlined text-primary text-[40px]" aria-hidden="true">{cancelada ? 'event_busy' : 'event_available'}</span>
      <h1 className="font-headline-md text-headline-md text-primary">{cancelada ? 'Reserva cancelada' : hecha.estado === 'confirmada' ? '¡Reserva confirmada!' : 'Recibimos tu reserva'}</h1>
      <p>{hecha.restaurante} · {hecha.fecha} a las <strong>{hecha.hora}</strong> · {hecha.personas} persona(s) · {hecha.duracionMin} min</p>
      {!cancelada && hecha.estado === 'pendiente' && <p className="text-on-surface-variant">El restaurante la confirmará pronto. Te contactarán al teléfono que dejaste.</p>}
      {!cancelada && <><p className="text-on-surface-variant">Guarda tu código para cancelar o consultar:</p><p className="font-headline-sm text-headline-sm tracking-widest text-center rounded-lg bg-surface-container p-space-sm select-all">{(hecha.codigo.toUpperCase().match(/.{1,4}/g) ?? []).join(' ')}</p>
        {error && <p role="alert" className="text-error">{error}</p>}<button type="button" onClick={cancelar} className="h-12 rounded-lg border border-error text-error font-semibold">Cancelar mi reserva</button></>}
    </section>);

  return envolver(
    <form onSubmit={reservar} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-lg flex flex-col gap-space-md">
      <header><h1 className="font-headline-md text-headline-md text-primary">Reserva en {info.data.restaurante}</h1><p className="text-on-surface-variant">Atendemos de {info.data.abre} a {info.data.cierra}. Cada reserva dura {info.data.duracionMin} minutos.</p></header>
      <div className="grid grid-cols-2 gap-space-sm">
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Fecha</span><input type="date" min={hoy()} value={fecha} onChange={(e) => { setFecha(e.target.value); setHora(''); }} required className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Personas</span><input type="number" min={1} max={info.data.maxPersonas} value={personas} onChange={(e) => { setPersonas(Math.max(1, Math.min(info.data!.maxPersonas, Number(e.target.value) || 1))); setHora(''); }} className={clases.input} /></label></div>
      <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Hora</legend>
        {disp.isLoading ? <p role="status">Buscando mesas…</p> : disp.isError ? <p role="alert" className="text-error">{mensajeDeError(disp.error)}</p> : (disp.data?.horas ?? []).length === 0 ? <p className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm">No hay mesas disponibles ese día para {personas} persona(s). Prueba con otra fecha.</p> : (
          <div className="grid grid-cols-4 gap-space-xs">{disp.data!.horas.map((h) => <button type="button" key={h} role="radio" aria-checked={hora === h} onClick={() => setHora(h)} className={`h-12 rounded-lg font-semibold ${hora === h ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{h}</button>)}</div>)}</fieldset>
      <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Tu nombre</span><input name="cliente" required minLength={2} maxLength={120} autoComplete="name" className={clases.input} /></label>
      <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Teléfono</span><input name="telefono" required minLength={6} inputMode="tel" autoComplete="tel" className={clases.input} /></label>
      <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Correo (opcional)</span><input name="email" type="email" autoComplete="email" className={clases.input} /></label>
      <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Comentarios (opcional)</span><input name="notas" maxLength={300} className={clases.input} /></label>
      {error && <p role="alert" className="text-error">{error}</p>}
      <button disabled={ocupado || !hora} className={clases.primario}>{ocupado ? 'Reservando…' : 'Reservar mesa'}</button>
    </form>);
}
