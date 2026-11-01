import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { cerrarKyrosId } from '../lib/kyrosid';
import { Cargando } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos, useSesion } from '../lib/sesion';
import { ETIQUETA_TIPO, minutosDesde, Ticket } from '../lib/tipos';

const META_MIN = 15; // tiempo objetivo de la comanda; pasado esto la cabecera se pone roja (pantalla 3.1)
const COLUMNAS: { id: Ticket['estado']; titulo: string; clase: string; punto: string }[] = [
  { id: 'nuevo', titulo: 'Nuevo', clase: 'bg-[#1f4e79]/70 text-white', punto: 'bg-[#a0cafc]' },
  { id: 'en_preparacion', titulo: 'En preparación', clase: 'bg-surface-variant/20 text-inverse-on-surface', punto: 'bg-secondary-container' },
  { id: 'listo', titulo: 'Listo / por servir', clase: 'bg-tertiary-container/70 text-white', punto: 'bg-tertiary-fixed-dim' },
];

/** Tablero de cocina (pantalla 3.1, modo oscuro): toques grandes, cronómetro por comanda y alerta de demora. */
export function Cocina() {
  const { estado, sesion, salir } = useSesion();
  const cfg = useQuery({ queryKey: ['kyros-id-config'], queryFn: () => api.kyrosIdConfig(), staleTime: Infinity });
  const { sucursalId, roles, esAdmin } = useRolesActivos();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [, reloj] = useState(0);
  useEffect(() => { const t = setInterval(() => reloj((n) => n + 1), 20_000); return () => clearInterval(t); }, []);

  const q = useQuery({ queryKey: ['tickets', sucursalId], queryFn: () => api.get<Ticket[]>('/cocina/tickets', sucursalId!), enabled: !!sucursalId && (esAdmin || roles.includes('cocina')), refetchInterval: 15_000 });
  const mover = useMutation({
    mutationFn: (v: { id: string; estado: 'en_preparacion' | 'listo'; item?: string }) => (v.item ? api.patch(`/items/${v.item}/cocina`, { estado: v.estado }, sucursalId!) : api.post(`/pedidos/${v.id}/cocina`, { estado: v.estado }, sucursalId!)),
    onSuccess: () => { setError(null); return qc.invalidateQueries({ queryKey: ['tickets', sucursalId] }); },
    onError: (e) => { setError(mensajeDeError(e)); void qc.invalidateQueries({ queryKey: ['tickets', sucursalId] }); },
  });

  if (estado === 'cargando') return <Cargando />;
  if (estado === 'anonimo' || !sesion) return <Navigate to="/" replace />;
  if (!esAdmin && !roles.includes('cocina')) return <Navigate to="/app" replace />;

  const tickets = q.data ?? [];
  const atrasados = tickets.filter((t) => t.estado !== 'listo' && minutosDesde(t.enviado) >= META_MIN).length;
  return (
    <div className="min-h-screen bg-inverse-surface text-inverse-on-surface flex flex-col">
      <header className="px-space-md py-space-sm flex flex-wrap items-center gap-space-md bg-black/20">
        <div className="flex items-center gap-space-sm"><div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center" aria-hidden="true"><span className="material-symbols-outlined">skillet</span></div>
          <div><h1 className="font-headline-sm text-headline-sm leading-tight">Cocina</h1><p className="font-label-sm text-label-sm uppercase tracking-wider opacity-70">Línea de producción</p></div></div>
        <div className="font-label-md text-label-md bg-white/10 rounded-lg px-space-md py-space-xs">ACTIVAS: {tickets.length} comandas</div>
        {atrasados > 0 && <div role="alert" className="font-label-md text-label-md bg-error-container text-on-error-container rounded-lg px-space-md py-space-xs flex items-center gap-1"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">notifications_active</span>{atrasados} atrasadas</div>}
        <div className="ml-auto flex items-center gap-space-sm"><span className="font-label-md text-label-md opacity-70">{new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' })}</span>{esAdmin && <Link to="/app" className="h-12 px-space-md rounded-lg bg-white/10 flex items-center font-semibold">Volver</Link>}<button type="button" onClick={async () => { await salir(); if (cfg.data) cerrarKyrosId(cfg.data); }} className="h-12 px-space-md rounded-lg bg-white/10 flex items-center font-semibold">Salir</button></div>
      </header>
      {error && <p role="alert" className="mx-space-md mt-space-sm rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}

      <main className="flex-1 grid grid-cols-1 gap-space-md p-space-md lg:grid-cols-3 lg:items-start">
        {q.isLoading ? <p role="status" className="lg:col-span-3">Cargando comandas…</p> : COLUMNAS.map((c) => {
          const lista = tickets.filter((t) => t.estado === c.id);
          return (
            <section key={c.id} aria-label={c.titulo} className="flex flex-col gap-space-sm">
              <h2 className={`rounded-xl px-space-md py-space-sm font-headline-sm text-headline-sm flex items-center justify-between ${c.clase}`}><span className="flex items-center gap-space-xs"><span className={`w-3 h-3 rounded-full ${c.punto}`} aria-hidden="true" />{c.titulo}</span><span className="bg-white/20 rounded-lg px-2 font-label-lg text-label-lg">{lista.length}</span></h2>
              {lista.length === 0 && <p className="text-center opacity-60 py-space-lg">Sin comandas</p>}
              {lista.map((t) => {
                const min = minutosDesde(t.enviado); const tarde = c.id !== 'listo' && min >= META_MIN;
                return (
                  <article key={t.id} className={`rounded-xl overflow-hidden border-2 ${tarde ? 'border-error' : 'border-white/10'} bg-[#1f2937]`}>
                    <div className={`px-space-md py-space-sm flex items-center justify-between gap-space-sm ${tarde ? 'bg-error text-on-error animate-pulse' : 'bg-white/5'}`}>
                      <div className="flex items-center gap-space-sm flex-wrap"><span className="font-label-lg text-label-lg">#{t.ticket ?? '—'}</span><span className="bg-secondary-container text-on-secondary-container rounded px-2 font-label-lg text-label-lg">{t.tipo === 'mesa' ? `MESA ${t.mesa}` : ETIQUETA_TIPO[t.tipo].toUpperCase()}</span></div>
                      <span className="font-label-lg text-label-lg flex items-center gap-1" aria-label={`${min} minutos`}><span className="material-symbols-outlined text-[18px]" aria-hidden="true">timer</span>{String(Math.floor(min / 60)).padStart(2, '0')}:{String(min % 60).padStart(2, '0')}</span>
                    </div>
                    <p className="px-space-md pt-space-xs font-body-sm text-body-sm opacity-70">{t.mesero ? `Mozo: ${t.mesero}` : t.cliente ? `Cliente: ${t.cliente}` : ''}{t.recojo ? ` · Recojo ${new Date(t.recojo).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
                    {t.comentario && <p className="mx-space-md mt-space-xs rounded bg-error-container text-on-error-container px-space-sm py-1 font-body-md font-semibold">⚠ {t.comentario}</p>}
                    <ul className="px-space-md py-space-sm flex flex-col gap-space-sm">
                      {t.items.map((i) => (
                        <li key={i.id} className="flex flex-col gap-1">
                          <div className="flex items-start justify-between gap-space-sm"><span className={`font-body-lg text-body-lg font-semibold ${i.estado === 'listo' ? 'opacity-50 line-through' : ''}`}>{Number(i.cantidad)}× {i.nombre}</span>
                            {i.estado !== 'listo' && t.items.length > 1 && <button type="button" onClick={() => mover.mutate({ id: t.id, estado: 'listo', item: i.id })} className="h-10 px-space-sm rounded-lg bg-white/10 font-label-md whitespace-nowrap">Listo parcial</button>}</div>
                          {(i.modificadores.length > 0 || i.nota) && <p className="rounded bg-secondary-container/90 text-on-secondary-container px-space-sm py-1 font-body-md font-semibold">{[...i.modificadores, i.nota].filter(Boolean).join(' · ')}</p>}
                        </li>
                      ))}
                    </ul>
                    <div className="p-space-sm">
                      {c.id === 'nuevo' && <button type="button" disabled={mover.isPending} onClick={() => mover.mutate({ id: t.id, estado: 'en_preparacion' })} className="w-full h-14 rounded-lg bg-tertiary-container text-white font-headline-sm text-headline-sm flex items-center justify-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">play_circle</span>INICIAR PREPARACIÓN</button>}
                      {c.id === 'en_preparacion' && <button type="button" disabled={mover.isPending} onClick={() => mover.mutate({ id: t.id, estado: 'listo' })} className="w-full h-14 rounded-lg bg-tertiary-container text-white font-headline-sm text-headline-sm flex items-center justify-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">check_circle</span>LISTO COMPLETO</button>}
                      {c.id === 'listo' && <p className="text-center py-space-xs font-semibold text-tertiary-fixed-dim flex items-center justify-center gap-1"><span className="material-symbols-outlined" aria-hidden="true">notifications_active</span>Mesero avisado · esperando recojo</p>}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </main>
    </div>
  );
}
