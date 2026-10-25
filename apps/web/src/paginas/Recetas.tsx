import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';

interface FilaPlato { platoId: string; nombre: string; precio: string; tieneReceta: boolean; recetaId: string | null; version: number | null; costo: string | null; margen: string | null; bajoMinimo: boolean }
interface Lista { margenMinimo: number; platos: FilaPlato[]; subRecetas: { recetaId: string; insumoId: string; nombre: string; version: number; rendimiento: string }[] }
interface Insumo { id: string; nombre: string; unidad: string; activo: boolean }
interface Unidad { codigo: string; base: string }
interface Detalle { id: string; platoId: string | null; insumoId: string | null; version: number; activa: boolean; rendimiento: string; mermaPct: string; instrucciones: string | null; costoPorPorcion: string | null; precio: string | null; margen: string | null; lineas: { insumoId: string; insumo: string; cantidad: string; unidad: string; costo: string }[] }
interface Version { id: string; version: number; activa: boolean; creada: string }
interface Linea { insumoId: string; cantidad: string; unidad: string }
type Destino = { tipo: 'plato'; id: string; nombre: string; recetaId: string | null } | { tipo: 'insumo'; id: string; nombre: string; recetaId: string | null };

/** Recetas & Costeo (pantalla 5.3): costo por porción, margen contra el precio y versiones de cada receta. */
export function Recetas() {
  const { sucursalId, esAdmin } = useRolesActivos();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['recetas', sucursalId], queryFn: () => api.get<Lista>('/recetas', sucursalId!), enabled: !!sucursalId });
  const insumos = useQuery({ queryKey: ['insumos', sucursalId], queryFn: () => api.get<Insumo[]>('/insumos', sucursalId!), enabled: !!sucursalId });
  const [editar, setEditar] = useState<Destino | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'sin' | 'bajo'>('todos');
  const [nuevaSub, setNuevaSub] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refrescar = () => { void qc.invalidateQueries({ queryKey: ['recetas', sucursalId] }); };
  const lista = q.data;
  const platos = (lista?.platos ?? []).filter((p) => filtro === 'todos' || (filtro === 'sin' ? !p.tieneReceta : p.bajoMinimo));
  const sinReceta = (lista?.platos ?? []).filter((p) => !p.tieneReceta).length;
  const bajos = (lista?.platos ?? []).filter((p) => p.bajoMinimo).length;
  const cambiarMargen = async () => { const v = prompt('Margen mínimo aceptable (%)', String(lista?.margenMinimo ?? 60)); if (v === null || Number.isNaN(Number(v))) return; try { await api.patch('/sucursal/ajustes', { margenMinimo: Number(v) }, sucursalId!); refrescar(); } catch (e) { setError(mensajeDeError(e)); } };

  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-end justify-between gap-space-md"><div><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Recetas &amp; Costeo</h1><p className="font-body-md text-body-md text-on-surface-variant">Cada plato con sus insumos. El costo se recalcula solo con el último precio de compra.</p></div>
        {esAdmin && lista && <button type="button" onClick={cambiarMargen} className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold">Margen mínimo: {lista.margenMinimo}%</button>}</header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <div className="flex flex-wrap gap-space-xs" role="tablist" aria-label="Filtro">
        {([['todos', `Todos (${lista?.platos.length ?? 0})`], ['sin', `Sin receta (${sinReceta})`], ['bajo', `Margen en riesgo (${bajos})`]] as const).map(([k, n]) => <button key={k} role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k)} className={`h-12 px-space-md rounded-lg font-semibold ${filtro === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}
      </div>
      {q.isLoading ? <p role="status">Cargando…</p> : platos.length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">{lista?.platos.length ? 'Ningún plato en este filtro.' : 'Primero carga tus platos en «Menú & Fotos».'}</p> : (
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="min-w-[44rem] w-full text-body-sm"><caption className="sr-only">Costo y margen por plato</caption>
          <thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Plato</th><th className="p-3 text-right">Precio</th><th className="p-3 text-right">Costo</th><th className="p-3 text-right">Margen</th><th className="p-3">Receta</th><th className="p-3" /></tr></thead>
          <tbody>{platos.map((p) => (
            <tr key={p.platoId} className={`border-t border-outline-variant ${p.bajoMinimo ? 'bg-error-container/20' : ''}`}>
              <td className="p-3 font-semibold">{p.nombre}</td><td className="p-3 text-right font-label-md">{bs(p.precio)}</td>
              <td className="p-3 text-right font-label-md">{p.costo ? bs(p.costo) : '—'}</td>
              <td className={`p-3 text-right font-label-md ${p.bajoMinimo ? 'text-error font-semibold' : ''}`}>{p.margen ? `${p.margen}%` : '—'}</td>
              <td className="p-3">{p.tieneReceta ? <span className="px-2 py-0.5 rounded-full font-label-sm bg-tertiary-fixed text-on-tertiary-fixed-variant">v{p.version}</span> : <span className="px-2 py-0.5 rounded-full font-label-sm bg-secondary-fixed text-on-secondary-fixed-variant">Sin receta</span>}</td>
              <td className="p-3 text-right"><button type="button" onClick={() => setEditar({ tipo: 'plato', id: p.platoId, nombre: p.nombre, recetaId: p.recetaId })} className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold">{p.tieneReceta ? 'Ver / editar' : 'Crear receta'}</button></td></tr>))}</tbody></table></div>
      )}
      <section aria-labelledby="subs" className="flex flex-col gap-space-sm"><h2 id="subs" className="font-headline-sm text-headline-sm">Sub-recetas (salsas y bases)</h2>
        <p className="font-body-sm text-on-surface-variant">Una sub-receta produce un insumo (por ejemplo «Salsa criolla»). Los platos que lo usan se calculan hasta los insumos básicos.</p>
        <ul className="flex flex-wrap gap-space-xs">{(lista?.subRecetas ?? []).map((s) => <li key={s.recetaId}><button type="button" onClick={() => setEditar({ tipo: 'insumo', id: s.insumoId, nombre: s.nombre, recetaId: s.recetaId })} className="h-12 px-space-md rounded-lg bg-surface-container font-semibold">{s.nombre} · v{s.version}</button></li>)}</ul>
        <div className="flex gap-space-sm"><select aria-label="Insumo que produce la sub-receta" value={nuevaSub} onChange={(e) => setNuevaSub(e.target.value)} className={`${clases.input} max-w-xs`}><option value="">Elige el insumo que produce…</option>{(insumos.data ?? []).filter((i) => i.activo && !lista?.subRecetas.some((s) => s.insumoId === i.id)).map((i) => <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>)}</select>
          <button type="button" disabled={!nuevaSub} onClick={() => { const i = insumos.data!.find((x) => x.id === nuevaSub)!; setEditar({ tipo: 'insumo', id: i.id, nombre: i.nombre, recetaId: null }); setNuevaSub(''); }} className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold disabled:opacity-50">Nueva sub-receta</button></div>
      </section>
      {editar && <EditorReceta destino={editar} insumos={(insumos.data ?? []).filter((i) => i.activo && !(editar.tipo === 'insumo' && i.id === editar.id))} cerrar={() => setEditar(null)} guardado={() => { refrescar(); }} />}
    </div>
  );
}

function EditorReceta({ destino, insumos, cerrar, guardado }: { destino: Destino; insumos: Insumo[]; cerrar(): void; guardado(): void }) {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const unidades = useQuery({ queryKey: ['unidades'], queryFn: () => api.get<Unidad[]>('/unidades', sucursalId!), enabled: !!sucursalId, staleTime: Infinity });
  const [recetaId, setRecetaId] = useState(destino.recetaId);
  const actual = useQuery({ queryKey: ['receta', sucursalId, recetaId], queryFn: () => api.get<Detalle>(`/recetas/${recetaId}`, sucursalId!), enabled: !!sucursalId && !!recetaId });
  const versiones = useQuery({ queryKey: ['receta-versiones', sucursalId, destino.id], queryFn: () => api.get<Version[]>(`/recetas/${destino.tipo}/${destino.id}/versiones`, sucursalId!), enabled: !!sucursalId && !!destino.recetaId });
  const [lineas, setLineas] = useState<Linea[] | null>(null); const [rend, setRend] = useState<string | null>(null); const [merma, setMerma] = useState<string | null>(null); const [instr, setInstr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null);
  const d = actual.data;
  const filas: Linea[] = lineas ?? d?.lineas.map((l) => ({ insumoId: l.insumoId, cantidad: Number(l.cantidad).toString(), unidad: l.unidad })) ?? [{ insumoId: '', cantidad: '', unidad: '' }];
  const compatibles = (insumoId: string) => { const ins = insumos.find((i) => i.id === insumoId); const base = unidades.data?.find((u) => u.codigo === ins?.unidad)?.base; return ins ? (unidades.data ?? []).filter((u) => u.base === base) : []; };
  const cambiar = (i: number, c: Partial<Linea>) => setLineas(filas.map((l, k) => (k === i ? { ...l, ...c } : l)));
  const sumaPorInsumo = useMemo(() => new Set(filas.map((l) => l.insumoId)).size !== filas.length, [filas]);

  const guardar = async (e: FormEvent) => {
    e.preventDefault(); setError(null); setOk(null);
    try {
      const r = await api.post<Detalle>('/recetas', { ...(destino.tipo === 'plato' ? { platoId: destino.id } : { insumoId: destino.id }), rendimiento: Number((rend ?? d?.rendimiento ?? '1').replace(',', '.')), mermaPct: Number((merma ?? d?.mermaPct ?? '0').replace(',', '.')), instrucciones: (instr ?? d?.instrucciones ?? '').trim() || undefined,
        lineas: filas.filter((l) => l.insumoId).map((l) => ({ insumoId: l.insumoId, cantidad: Number(l.cantidad.replace(',', '.')), unidad: l.unidad || insumos.find((i) => i.id === l.insumoId)!.unidad })) }, sucursalId!);
      setRecetaId(r.id); setLineas(null); setRend(null); setMerma(null); setInstr(null); setOk(`Guardada como versión ${r.version}. Costo por porción: ${r.costoPorPorcion ? bs(r.costoPorPorcion) : '—'}${r.margen ? ` · margen ${r.margen}%` : ''}.`);
      void qc.invalidateQueries({ queryKey: ['receta-versiones'] }); guardado();
    } catch (err) { setError(mensajeDeError(err, 'No pudimos guardar la receta.')); }
  };
  const activar = async (id: string) => { setError(null); try { const r = await api.post<Detalle>(`/recetas/${id}/activar`, undefined, sucursalId!); setRecetaId(r.id); setLineas(null); void qc.invalidateQueries({ queryKey: ['receta-versiones'] }); guardado(); } catch (err) { setError(mensajeDeError(err)); } };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Receta de ${destino.nombre}`} className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <form onSubmit={guardar} onClick={(e) => e.stopPropagation()} className="w-full max-w-xl bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><div><h2 className="font-headline-md text-headline-md text-primary">{destino.nombre}</h2><p className="font-body-sm text-on-surface-variant">{destino.tipo === 'plato' ? 'Receta del plato' : 'Sub-receta: produce este insumo'}{d ? ` · versión ${d.version}${d.activa ? ' (activa)' : ' (anterior)'}` : ' · nueva'}</p></div><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        {d && <div className="grid grid-cols-3 gap-space-xs text-center"><div className="rounded-lg bg-surface-container p-space-sm"><p className={clases.etiqueta}>Costo/porción</p><p className="font-label-lg">{d.costoPorPorcion ? bs(d.costoPorPorcion) : '—'}</p></div><div className="rounded-lg bg-surface-container p-space-sm"><p className={clases.etiqueta}>Precio</p><p className="font-label-lg">{d.precio ? bs(d.precio) : '—'}</p></div><div className="rounded-lg bg-surface-container p-space-sm"><p className={clases.etiqueta}>Margen</p><p className="font-label-lg">{d.margen ? `${d.margen}%` : '—'}</p></div></div>}
        <div className="grid grid-cols-2 gap-space-sm"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>{destino.tipo === 'plato' ? 'Rendimiento (porciones)' : 'Rinde (unidades del insumo)'}</span><input value={rend ?? d?.rendimiento ?? '1'} onChange={(e) => setRend(e.target.value)} inputMode="decimal" required className={`${clases.input} font-label-lg`} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Merma (%)</span><input value={merma ?? d?.mermaPct ?? '0'} onChange={(e) => setMerma(e.target.value)} inputMode="decimal" className={`${clases.input} font-label-lg`} /></label></div>
        <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Insumos de la receta</legend>
          {filas.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_5.5rem_4.5rem_2.5rem] gap-space-xs items-center">
              <select aria-label="Insumo" value={l.insumoId} onChange={(e) => cambiar(i, { insumoId: e.target.value, unidad: insumos.find((x) => x.id === e.target.value)?.unidad ?? '' })} className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm min-w-0"><option value="">Elige…</option>{insumos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
              <input aria-label="Cantidad" value={l.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} inputMode="decimal" className="h-12 rounded-lg border border-outline-variant px-space-sm font-label-lg w-full" />
              <select aria-label="Unidad" value={l.unidad} onChange={(e) => cambiar(i, { unidad: e.target.value })} className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-1">{compatibles(l.insumoId).map((u) => <option key={u.codigo} value={u.codigo}>{u.codigo}</option>)}</select>
              <button type="button" aria-label="Quitar insumo" onClick={() => setLineas(filas.filter((_, k) => k !== i))} className="w-10 h-12 text-error"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
            </div>))}
          <button type="button" onClick={() => setLineas([...filas, { insumoId: '', cantidad: '', unidad: '' }])} className="h-12 rounded-lg border border-dashed border-outline text-primary font-semibold">+ Agregar insumo</button>
          {sumaPorInsumo && <p role="alert" className="text-error font-body-sm">Un insumo solo puede aparecer una vez.</p>}
        </fieldset>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Preparación (opcional)</span><textarea value={instr ?? d?.instrucciones ?? ''} onChange={(e) => setInstr(e.target.value)} rows={3} maxLength={4000} className={`${clases.input} h-auto py-space-sm`} /></label>
        {error && <p role="alert" className="text-error">{error}</p>}{ok && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{ok}</p>}
        <button disabled={sumaPorInsumo} className={clases.primario}>{d ? 'Guardar como versión nueva' : 'Crear receta'}</button>
        {(versiones.data ?? []).length > 1 && <section><h3 className={clases.etiqueta}>Versiones</h3><ul className="mt-space-xs flex flex-col gap-1">{versiones.data!.map((v) => <li key={v.id} className="flex items-center justify-between gap-space-sm rounded-lg bg-surface-container p-space-sm"><span>Versión {v.version} · {new Date(v.creada).toLocaleDateString('es-BO')}{v.activa ? ' · activa' : ''}</span>{!v.activa && <button type="button" onClick={() => activar(v.id)} className="h-12 px-space-sm rounded-lg border border-outline-variant text-primary font-semibold">Volver a esta</button>}</li>)}</ul></section>}
      </form>
    </div>
  );
}
