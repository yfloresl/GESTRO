import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';

interface Punto { texto: string; metrica: string }
interface Informe { id: string; desde: string; hasta: string; modelo: string; creado: string; suficiente: boolean; motivo: string | null; fortalezas: Punto[]; debilidades: Punto[]; oportunidades: Punto[]; amenazas: Punto[]; evidencia: Record<string, { valor: string | number; detalle: string }>; descartadosPorValidacion: number; iaNoDisponible: string | null }
interface Resumen { id: string; desde: string; hasta: string; modelo: string; creado: string; puntos: number }

const hoy = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
const sumar = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const CUADRANTES = [
  { k: 'fortalezas', t: 'Fortalezas', i: 'thumb_up', c: 'border-tertiary' }, { k: 'debilidades', t: 'Debilidades', i: 'report_problem', c: 'border-error' },
  { k: 'oportunidades', t: 'Oportunidades', i: 'lightbulb', c: 'border-primary' }, { k: 'amenazas', t: 'Amenazas', i: 'warning', c: 'border-secondary' },
] as const;

/** Informe FODA (pantalla 5.12): cada punto muestra la métrica que lo respalda; con pocos datos lo declara. */
export function Foda() {
  const { sucursalId, esAdmin } = useRolesActivos();
  const qc = useQueryClient(); const [sel, setSel] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false); const [dias, setDias] = useState(30);
  const lista = useQuery({ queryKey: ['foda', sucursalId], queryFn: () => api.get<Resumen[]>('/reportes/foda', sucursalId!), enabled: !!sucursalId });
  const id = sel ?? lista.data?.[0]?.id ?? null;
  const q = useQuery({ queryKey: ['foda', sucursalId, id], queryFn: () => api.get<Informe>(`/reportes/foda/${id}`, sucursalId!), enabled: !!sucursalId && !!id });
  if (!sucursalId) return null;
  const generar = async () => {
    setError(null); setOcupado(true);
    try { const r = await api.post<Informe>('/reportes/foda/generar', { desde: sumar(hoy(), -(dias - 1)), hasta: hoy() }, sucursalId); setSel(r.id); await qc.invalidateQueries({ queryKey: ['foda'] }); } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(false); }
  };
  const inf = q.data;
  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-end justify-between gap-space-sm"><div><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Informe FODA</h1><p className="font-body-md text-body-md text-on-surface-variant">Fortalezas, debilidades, oportunidades y amenazas con los números reales de tu restaurante.</p></div>
        {esAdmin && <div className="flex flex-wrap items-center gap-space-xs"><select aria-label="Período" value={dias} onChange={(e) => setDias(Number(e.target.value))} className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm">{[[30, 'Últimos 30 días'], [60, 'Últimos 60 días'], [90, 'Últimos 90 días']].map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
          <button type="button" disabled={ocupado} onClick={generar} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-space-xs disabled:opacity-60"><span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>{ocupado ? 'Generando…' : 'Generar informe'}</button></div>}</header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {(lista.data ?? []).length > 1 && <div className="flex gap-space-xs overflow-x-auto">{lista.data!.map((r) => <button key={r.id} aria-pressed={id === r.id} onClick={() => setSel(r.id)} className={`h-12 px-space-md rounded-full font-label-md whitespace-nowrap ${id === r.id ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{r.desde.slice(5)} → {r.hasta.slice(5)}</button>)}</div>}
      {lista.isLoading ? <p role="status">Cargando…</p> : !id ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Todavía no hay informes. {esAdmin ? 'Genera el primero con el botón de arriba.' : 'Pídele al dueño que lo genere.'} El informe del mes anterior se arma solo el día 1 de cada mes.</p> : !inf ? <p role="status">Cargando informe…</p> : <>
        <p className="font-body-sm text-on-surface-variant">Período {inf.desde} → {inf.hasta} · {inf.modelo === 'reglas' ? 'Armado con reglas sobre tus indicadores' : `Redactado con IA (${inf.modelo}) y verificado contra tus números`} · {new Date(inf.creado).toLocaleString('es-BO')}</p>
        {inf.iaNoDisponible && <p role="status" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm">La IA no estuvo disponible ({inf.iaNoDisponible}); se muestra el análisis armado con reglas.</p>}
        {inf.descartadosPorValidacion > 0 && <p role="status" className="font-body-sm text-on-surface-variant">Se descartaron {inf.descartadosPorValidacion} punto(s) redactados por la IA porque sus cifras no coincidían con tus datos.</p>}
        {inf.motivo && <p role="status" className="rounded-xl bg-secondary-fixed text-on-secondary-fixed-variant p-space-md">{inf.motivo}</p>}
        <div className="grid grid-cols-1 gap-gutter md:grid-cols-2">{CUADRANTES.map((c) => (
          <section key={c.k} className={`bg-surface-container-lowest border border-outline-variant border-t-4 ${c.c} rounded-xl p-space-md flex flex-col gap-space-xs`}>
            <h2 className="font-headline-sm text-headline-sm flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">{c.i}</span>{c.t}</h2>
            {inf[c.k].length === 0 ? <p className="text-on-surface-variant">Sin señales claras en este período.</p> : <ul className="flex flex-col gap-space-sm">{inf[c.k].map((p, i) => (
              <li key={i} className="flex flex-col gap-1"><p>{p.texto}</p>
                <details><summary className="cursor-pointer text-primary font-label-md min-h-12 flex items-center">Evidencia: {p.metrica.replace(/_/g, ' ')}</summary><p className="font-body-sm text-on-surface-variant rounded-lg bg-surface-container p-space-sm">{inf.evidencia[p.metrica]?.detalle ?? 'Sin detalle.'}</p></details></li>))}</ul>}
          </section>))}</div>
      </>}
    </div>
  );
}
