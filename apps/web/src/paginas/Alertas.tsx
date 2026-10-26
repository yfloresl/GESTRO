import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';

interface Alerta { id: string; tipo: string; severidad: 'info' | 'media' | 'alta'; mensaje: string; datos: Record<string, unknown> | null; creada: string; resuelta: string | null }

const TIPO: Record<string, { t: string; i: string }> = {
  demora_cocina: { t: 'Demora en cocina', i: 'timer' }, merma_alta: { t: 'Merma alta', i: 'delete_sweep' }, margen_bajo: { t: 'Margen bajo', i: 'trending_down' }, ventas_bajas: { t: 'Caída de ventas', i: 'show_chart' },
  stock_bajo: { t: 'Stock bajo', i: 'inventory_2' }, precio_alto: { t: 'Alza de precio', i: 'sell' }, contabilidad: { t: 'Contabilidad', i: 'account_balance' },
};
const SEV: Record<Alerta['severidad'], { t: string; c: string }> = { alta: { t: 'Importante', c: 'bg-error-container text-on-error-container' }, media: { t: 'Atención', c: 'bg-secondary-fixed text-on-secondary-fixed-variant' }, info: { t: 'Aviso', c: 'bg-surface-container text-on-surface-variant' } };
const ETIQUETA: Record<string, string> = { minutosEnCocina: 'Minutos en cocina', limiteMinutos: 'Límite (min)', platoMasLento: 'Plato más lento', ticket: 'Pedido', mesa: 'Mesa', merma: 'Merma (Bs)', ingresos: 'Ventas (Bs)', mermaPct: 'Merma %', limitePct: 'Límite %', desde: 'Desde', hasta: 'Hasta',
  precio: 'Precio (Bs)', costoPorPorcion: 'Costo por porción (Bs)', margenPct: 'Margen %', minimoPct: 'Mínimo %', plato: 'Plato', fecha: 'Fecha', ventas: 'Ventas (Bs)', habitual: 'Habitual (Bs)', porcentaje: 'Porcentaje %', semanasComparadas: 'Semanas comparadas' };
const OCULTAS = new Set(['clave', 'pedidoId', 'platoId', 'masPesados']);

/** Alertas (pantalla 5.11): cada una explica qué pasa, con qué números y contra qué límite. */
export function Alertas() {
  const { sucursalId, esAdmin } = useRolesActivos();
  const qc = useQueryClient(); const [estado, setEstado] = useState<'abiertas' | 'resueltas'>('abiertas'); const [error, setError] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['alertas', sucursalId, estado], queryFn: () => api.get<Alerta[]>(`/alertas?estado=${estado}`, sucursalId!), enabled: !!sucursalId, refetchInterval: 60_000 });
  if (!sucursalId) return null;
  const accion = async (f: () => Promise<unknown>, ok?: string) => { setError(null); setMsg(null); try { await f(); if (ok) setMsg(ok); await qc.invalidateQueries({ queryKey: ['alertas'] }); } catch (e) { setError(mensajeDeError(e)); } };
  const lista = q.data ?? [];
  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-end justify-between gap-space-sm"><div><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Alertas</h1><p className="font-body-md text-body-md text-on-surface-variant">Se revisan solas cada pocos minutos. Cada una muestra los datos que la sustentan.</p></div>
        {esAdmin && <button type="button" onClick={() => accion(async () => { const r = await api.post<{ nuevas: number }>('/alertas/revisar', undefined, sucursalId); setMsg(r.nuevas ? `Se encontraron ${r.nuevas} alerta(s) nueva(s).` : 'Todo en orden: no hay alertas nuevas.'); })} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">refresh</span>Revisar ahora</button>}</header>
      <div className="flex gap-space-xs">{([['abiertas', 'Abiertas'], ['resueltas', 'Resueltas']] as const).map(([k, n]) => <button key={k} aria-pressed={estado === k} onClick={() => setEstado(k)} className={`h-12 px-space-md rounded-full font-label-md ${estado === k ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}{msg && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}
      {q.isLoading ? <p role="status">Cargando…</p> : lista.length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">{estado === 'abiertas' ? 'No hay alertas abiertas. Todo en orden.' : 'Todavía no hay alertas resueltas.'}</p> : (
        <ul className="flex flex-col gap-space-sm">{lista.map((a) => {
          const tipo = TIPO[a.tipo] ?? { t: a.tipo, i: 'notifications' };
          const datos = Object.entries(a.datos ?? {}).filter(([k]) => !OCULTAS.has(k));
          const top = (a.datos?.masPesados as { name: string; valor: string }[] | undefined) ?? [];
          return (
            <li key={a.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-xs">
              <div className="flex items-center justify-between gap-space-sm"><span className="flex items-center gap-space-xs font-semibold"><span className="material-symbols-outlined" aria-hidden="true">{tipo.i}</span>{tipo.t}</span><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase whitespace-nowrap ${SEV[a.severidad].c}`}>{SEV[a.severidad].t}</span></div>
              <p>{a.mensaje}</p>
              <p className="font-body-sm text-on-surface-variant">{new Date(a.creada).toLocaleString('es-BO')}{a.resuelta ? ` · resuelta ${new Date(a.resuelta).toLocaleString('es-BO')}` : ''}</p>
              {datos.length > 0 && <details><summary className="cursor-pointer text-primary font-semibold min-h-12 flex items-center">Ver los datos</summary>
                <dl className="grid grid-cols-2 gap-x-space-md gap-y-1 font-body-sm">{datos.map(([k, v]) => <div key={k} className="contents"><dt className="text-on-surface-variant">{ETIQUETA[k] ?? k}</dt><dd className="font-label-md text-right">{String(v)}</dd></div>)}</dl>
                {top.length > 0 && <p className="font-body-sm mt-1">Lo que más pesó: {top.map((x) => `${x.name} (Bs ${x.valor})`).join(', ')}</p>}</details>}
              {esAdmin && !a.resuelta && <button type="button" onClick={() => accion(() => api.post(`/alertas/${a.id}/resolver`, undefined, sucursalId))} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold self-start">Marcar como resuelta</button>}
            </li>);
        })}</ul>)}
    </div>
  );
}
