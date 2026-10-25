import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';

interface Insumo { id: string; nombre: string; categoria: string | null; unidad: string; minimo: number; ultimoCosto: string; costoPromedio: string; perecedero: boolean; metodoCosto: string; activo: boolean; stock: string; valor: string; estado: 'agotado' | 'bajo' | 'optimo' }
interface Almacen { id: string; nombre: string }
interface Unidad { codigo: string; base: string; factor: number }
interface Alertas { bajoMinimo: { insumoId: string; insumo: string; unidad: string; stock: string; minimo: string }[]; negativos: { insumoId: string; insumo: string; unidad: string; almacen: string; cantidad: string }[]; porVencer: { insumoId: string; insumo: string; lote: string; vence: string; dias: number; almacen: string; saldo: string; unidad: string }[] }
interface Kardex { id: string; tipo: string; cantidad: string; costo: string | null; lote: string | null; vence: string | null; motivo: string | null; fecha: string; almacen: string; saldo: string }
type Pestana = 'existencias' | 'movimientos' | 'kardex' | 'conteo' | 'insumos';

const ESTADO = { agotado: { t: 'Agotado', c: 'bg-error-container text-on-error-container' }, bajo: { t: 'Stock bajo', c: 'bg-secondary-fixed text-on-secondary-fixed-variant' }, optimo: { t: 'Óptimo', c: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' } } as const;
const TIPO_MOV: Record<string, string> = { compra: 'Entrada (compra)', consumo: 'Consumo', merma: 'Merma', ajuste: 'Ajuste', traspaso_in: 'Traspaso (entra)', traspaso_out: 'Traspaso (sale)', produccion: 'Producción' };
const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(',', '.'));

/** Inventario & Almacenes (pantalla 5.4): existencias valoradas, movimientos, kardex, conteo físico y alertas. */
export function Inventario() {
  const { sucursalId, esAdmin, roles } = useRolesActivos();
  const puedeGestionar = esAdmin || roles.includes('almacen');
  const [p, setP] = useState<Pestana>('existencias');
  const qc = useQueryClient();
  const insumos = useQuery({ queryKey: ['insumos', sucursalId], queryFn: () => api.get<Insumo[]>('/insumos', sucursalId!), enabled: !!sucursalId });
  const almacenes = useQuery({ queryKey: ['almacenes', sucursalId], queryFn: () => api.get<Almacen[]>('/almacenes', sucursalId!), enabled: !!sucursalId });
  const alertas = useQuery({ queryKey: ['stock-alertas', sucursalId], queryFn: () => api.get<Alertas>('/stock/alertas', sucursalId!), enabled: !!sucursalId, refetchInterval: 60_000 });
  const refrescar = () => { for (const k of ['insumos', 'almacenes', 'stock-alertas', 'kardex']) void qc.invalidateQueries({ queryKey: [k] }); };
  const lista = insumos.data ?? [];
  const valorTotal = lista.reduce((t, i) => t + Number(i.valor), 0);
  const criticos = alertas.data ? alertas.data.bajoMinimo.length + alertas.data.negativos.length : 0;
  const pestanas: [Pestana, string][] = [['existencias', 'Existencias'], ...(puedeGestionar ? [['movimientos', 'Movimientos'] as [Pestana, string]] : []), ['kardex', 'Kardex'], ...(puedeGestionar ? [['conteo', 'Conteo físico'] as [Pestana, string], ['insumos', 'Insumos y almacenes'] as [Pestana, string]] : [])];

  return (
    <div className="flex flex-col gap-space-lg">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Inventario &amp; Almacenes</h1><p className="font-body-md text-body-md text-on-surface-variant">El stock cambia solo por movimientos: cada entrada, merma, traspaso o conteo queda en el kardex.</p></header>
      <section className="grid grid-cols-1 gap-gutter sm:grid-cols-3">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><p className={clases.etiqueta}>Valor del inventario</p><p className="font-headline-lg text-headline-lg text-primary font-label-lg">{bs(valorTotal)}</p><p className="font-body-sm text-on-surface-variant">Al costo promedio</p></div>
        <div className={`border rounded-xl p-space-md ${criticos ? 'bg-error-container/40 border-error-container' : 'bg-surface-container-lowest border-outline-variant'}`}><p className={clases.etiqueta}>Insumos críticos</p><p className="font-headline-lg text-headline-lg font-label-lg">{criticos}</p><p className="font-body-sm text-on-surface-variant">{alertas.data ? `${alertas.data.bajoMinimo.length} bajo el mínimo · ${alertas.data.negativos.length} en negativo` : '—'}</p></div>
        <div className={`border rounded-xl p-space-md ${alertas.data?.porVencer.length ? 'bg-secondary-fixed/50 border-secondary-container' : 'bg-surface-container-lowest border-outline-variant'}`}><p className={clases.etiqueta}>Próximos a vencer</p><p className="font-headline-lg text-headline-lg font-label-lg">{alertas.data?.porVencer.length ?? 0}</p><p className="font-body-sm text-on-surface-variant">Lotes en los próximos 7 días</p></div>
      </section>
      <div className="flex gap-space-xs overflow-x-auto" role="tablist" aria-label="Secciones">{pestanas.map(([k, n]) => <button key={k} role="tab" aria-selected={p === k} onClick={() => setP(k)} className={`h-12 px-space-md rounded-lg font-semibold whitespace-nowrap ${p === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
      {p === 'existencias' && <Existencias lista={lista} cargando={insumos.isLoading} alertas={alertas.data} />}
      {p === 'movimientos' && <Movimientos insumos={lista.filter((i) => i.activo)} almacenes={almacenes.data ?? []} hecho={refrescar} />}
      {p === 'kardex' && <KardexVista insumos={lista} almacenes={almacenes.data ?? []} />}
      {p === 'conteo' && <Conteo insumos={lista.filter((i) => i.activo)} almacenes={almacenes.data ?? []} hecho={refrescar} />}
      {p === 'insumos' && <Catalogo insumos={lista} almacenes={almacenes.data ?? []} hecho={refrescar} />}
    </div>
  );
}

function Existencias({ lista, cargando, alertas }: { lista: Insumo[]; cargando: boolean; alertas?: Alertas }) {
  const [f, setF] = useState<'todos' | 'agotado' | 'bajo' | 'optimo'>('todos'); const [b, setB] = useState('');
  const v = lista.filter((i) => i.activo && (f === 'todos' || i.estado === f) && i.nombre.toLowerCase().includes(b.toLowerCase()));
  return (
    <section className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap gap-space-sm items-center">
        <label className="relative flex-1 min-w-[12rem]"><span className="sr-only">Buscar insumo</span><span className="material-symbols-outlined absolute left-3 top-3 text-on-surface-variant" aria-hidden="true">search</span><input value={b} onChange={(e) => setB(e.target.value)} placeholder="Buscar insumo" className={`${clases.input} pl-11 h-12`} /></label>
        {(['todos', 'agotado', 'bajo', 'optimo'] as const).map((k) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)} className={`h-12 px-space-md rounded-full font-label-md ${f === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{k === 'todos' ? `Todos (${lista.filter((i) => i.activo).length})` : ESTADO[k].t}</button>)}
      </div>
      {cargando ? <p role="status">Cargando…</p> : v.length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">{lista.length ? 'Ningún insumo coincide.' : 'Todavía no hay insumos. Créalos en «Insumos y almacenes».'}</p> : (
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="min-w-[44rem] w-full text-body-sm"><caption className="sr-only">Existencias por insumo</caption>
          <thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Insumo</th><th className="p-3 text-right">Stock</th><th className="p-3 text-right">Mínimo</th><th className="p-3 text-right">Costo prom.</th><th className="p-3 text-right">Valor</th><th className="p-3">Estado</th></tr></thead>
          <tbody>{v.map((i) => { const pct = i.minimo > 0 ? Math.max(0, Math.min(100, (Number(i.stock) / i.minimo) * 100)) : 100; return (
            <tr key={i.id} className={`border-t border-outline-variant ${i.estado === 'agotado' ? 'bg-error-container/20' : i.estado === 'bajo' ? 'bg-secondary-fixed/20' : ''}`}>
              <td className="p-3"><p className="font-semibold">{i.nombre}</p><p className="text-on-surface-variant">{i.categoria ?? 'Sin categoría'}{alertas?.porVencer.some((x) => x.insumoId === i.id) ? ' · lote por vencer' : ''}</p></td>
              <td className="p-3 text-right font-label-lg">{Number(i.stock)} {i.unidad}<div className="h-1.5 mt-1 rounded bg-surface-container-high overflow-hidden" aria-hidden="true"><div className={`h-full ${i.estado === 'optimo' ? 'bg-tertiary-container' : i.estado === 'bajo' ? 'bg-secondary-container' : 'bg-error'}`} style={{ width: `${pct}%` }} /></div></td>
              <td className="p-3 text-right font-label-md text-on-surface-variant">{i.minimo} {i.unidad}</td><td className="p-3 text-right font-label-md">{bs(i.costoPromedio)}</td><td className="p-3 text-right font-label-md">{bs(i.valor)}</td>
              <td className="p-3"><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase whitespace-nowrap ${ESTADO[i.estado].c}`}>{ESTADO[i.estado].t}</span></td></tr>); })}</tbody></table></div>
      )}
    </section>
  );
}

function Movimientos({ insumos, almacenes, hecho }: { insumos: Insumo[]; almacenes: Almacen[]; hecho(): void }) {
  const { sucursalId } = useRolesActivos();
  const unidades = useQuery({ queryKey: ['unidades'], queryFn: () => api.get<Unidad[]>('/unidades', sucursalId!), enabled: !!sucursalId, staleTime: Infinity });
  const [tipo, setTipo] = useState<'compra' | 'merma' | 'ajuste' | 'traspaso'>('compra');
  const [insumoId, setInsumoId] = useState(''); const [msg, setMsg] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const ins = insumos.find((i) => i.id === insumoId);
  const compatibles = useMemo(() => { const base = unidades.data?.find((u) => u.codigo === ins?.unidad)?.base; return (unidades.data ?? []).filter((u) => u.base === base); }, [unidades.data, ins]);
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); setMsg(null); const f = new FormData(e.currentTarget); const form = e.currentTarget; const s = (k: string) => String(f.get(k) ?? '').trim();
    try {
      const comun = { insumoId, cantidad: num(f.get('cantidad')), unidad: s('unidad') || undefined };
      if (tipo === 'traspaso') await api.post('/stock/traspasos', { ...comun, origenId: s('origen'), destinoId: s('destino') }, sucursalId!);
      else await api.post('/stock/movimientos', { ...comun, tipo, almacenId: s('almacen'), ...(tipo === 'compra' ? { costoUnitario: num(f.get('costo')), lote: s('lote') || undefined, vence: s('vence') || undefined } : { motivo: s('motivo') }), ...(tipo === 'ajuste' ? { sentido: s('sentido') } : {}) }, sucursalId!);
      setMsg('Movimiento registrado en el kardex.'); form.reset(); setInsumoId(''); hecho();
    } catch (err) { setError(mensajeDeError(err)); }
  };
  const sel = (nombre: string, et: string) => <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>{et}</span><select name={nombre} required className={clases.input}><option value="">Elige…</option>{almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>;
  return (
    <form onSubmit={enviar} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-1 gap-space-sm md:grid-cols-2 max-w-3xl">
      <div className="md:col-span-2 grid grid-cols-2 gap-space-xs sm:grid-cols-4" role="radiogroup" aria-label="Tipo de movimiento">
        {([['compra', 'Entrada'], ['merma', 'Merma'], ['ajuste', 'Ajuste'], ['traspaso', 'Traspaso']] as const).map(([k, n]) => <button key={k} type="button" role="radio" aria-checked={tipo === k} onClick={() => setTipo(k)} className={`h-12 rounded-lg font-semibold ${tipo === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}
      </div>
      <label className="flex flex-col gap-space-xs md:col-span-2"><span className={clases.etiqueta}>Insumo</span><select value={insumoId} onChange={(e) => setInsumoId(e.target.value)} required className={clases.input}><option value="">Elige…</option>{insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>)}</select></label>
      {tipo === 'traspaso' ? <>{sel('origen', 'Sale de')}{sel('destino', 'Entra a')}</> : sel('almacen', 'Almacén')}
      <div className="grid grid-cols-2 gap-space-sm"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Cantidad</span><input name="cantidad" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" className={`${clases.input} font-label-lg`} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Unidad</span><select name="unidad" className={clases.input}><option value="">{ins ? ins.unidad : 'La del insumo'}</option>{compatibles.filter((u) => u.codigo !== ins?.unidad).map((u) => <option key={u.codigo} value={u.codigo}>{u.codigo}</option>)}</select></label></div>
      {tipo === 'compra' && <><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Costo unitario (Bs por unidad elegida)</span><input name="costo" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,4})?" className={`${clases.input} font-label-lg`} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Lote (opcional)</span><input name="lote" maxLength={40} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Vence (opcional)</span><input name="vence" type="date" className={clases.input} /></label></>}
      {tipo === 'ajuste' && <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Sentido</span><select name="sentido" required className={clases.input}><option value="entrada">Entrada (sobra)</option><option value="salida">Salida (falta)</option></select></label>}
      {(tipo === 'merma' || tipo === 'ajuste') && <label className="flex flex-col gap-space-xs md:col-span-2"><span className={clases.etiqueta}>Motivo (obligatorio)</span><input name="motivo" required minLength={3} maxLength={200} placeholder={tipo === 'merma' ? 'Maduración, rotura, vencimiento…' : 'Qué lo explica'} className={clases.input} /></label>}
      {error && <p role="alert" className="md:col-span-2 text-error">{error}</p>}{msg && <p role="status" className="md:col-span-2 rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}
      <button className={`${clases.primario} md:col-span-2`}>Registrar en el kardex</button>
    </form>
  );
}

function KardexVista({ insumos, almacenes }: { insumos: Insumo[]; almacenes: Almacen[] }) {
  const { sucursalId } = useRolesActivos(); const [id, setId] = useState(''); const [alm, setAlm] = useState('');
  const q = useQuery({ queryKey: ['kardex', sucursalId, id, alm], queryFn: () => api.get<Kardex[]>(`/stock/kardex/${id}${alm ? `?almacenId=${alm}` : ''}`, sucursalId!), enabled: !!sucursalId && !!id });
  return (
    <section className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap gap-space-sm"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Insumo</span><select value={id} onChange={(e) => setId(e.target.value)} className={clases.input}><option value="">Elige…</option>{insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}</select></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Almacén</span><select value={alm} onChange={(e) => setAlm(e.target.value)} className={clases.input}><option value="">Todos</option>{almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label></div>
      {!id ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Elige un insumo para ver su historial de movimientos.</p> : q.isLoading ? <p role="status">Cargando…</p> : (q.data ?? []).length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Este insumo no tiene movimientos.</p> : (
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="min-w-[44rem] w-full text-body-sm"><caption className="sr-only">Kardex</caption>
          <thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Fecha</th><th className="p-3">Movimiento</th><th className="p-3">Almacén</th><th className="p-3 text-right">Cantidad</th><th className="p-3 text-right">Saldo</th><th className="p-3">Detalle</th></tr></thead>
          <tbody>{q.data!.map((k) => <tr key={k.id} className="border-t border-outline-variant"><td className="p-3 whitespace-nowrap">{new Date(k.fecha).toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short' })}</td><td className="p-3">{TIPO_MOV[k.tipo] ?? k.tipo}</td><td className="p-3">{k.almacen}</td><td className={`p-3 text-right font-label-md ${Number(k.cantidad) < 0 ? 'text-error' : 'text-tertiary'}`}>{Number(k.cantidad) > 0 ? '+' : ''}{Number(k.cantidad)}</td><td className="p-3 text-right font-label-md">{Number(k.saldo)}</td><td className="p-3 text-on-surface-variant">{[k.costo ? `Bs ${Number(k.costo)}/u` : '', k.lote ? `lote ${k.lote}` : '', k.vence ? `vence ${k.vence}` : '', k.motivo ?? ''].filter(Boolean).join(' · ')}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

function Conteo({ insumos, almacenes, hecho }: { insumos: Insumo[]; almacenes: Almacen[]; hecho(): void }) {
  const { sucursalId } = useRolesActivos(); const [alm, setAlm] = useState(''); const [vals, setVals] = useState<Record<string, string>>({}); const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ lineas: { nombre: string; unidad: string; sistema: string; contado: string; diferencia: string; valor: string }[]; valorDiferencia: string } | null>(null);
  const niveles = useQuery({ queryKey: ['niveles', sucursalId, alm], queryFn: () => api.get<{ insumoId: string; cantidad: string }[]>(`/stock/niveles?almacenId=${alm}`, sucursalId!), enabled: !!sucursalId && !!alm });
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null);
    const lineas = Object.entries(vals).filter(([, v]) => v.trim() !== '').map(([insumoId, v]) => ({ insumoId, contado: num(v) }));
    if (!lineas.length) { setError('Escribe lo contado en al menos un insumo.'); return; }
    if (!confirm('Se ajustará el stock a lo contado. ¿Continuar?')) return;
    try { setRes(await api.post('/stock/conteos', { almacenId: alm, motivo: String(new FormData(e.currentTarget).get('motivo') ?? '').trim() || undefined, lineas }, sucursalId!)); setVals({}); hecho(); } catch (err) { setError(mensajeDeError(err)); }
  };
  return (
    <form onSubmit={enviar} className="flex flex-col gap-space-sm max-w-3xl">
      <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Almacén a contar</span><select value={alm} onChange={(e) => { setAlm(e.target.value); setRes(null); }} required className={clases.input}><option value="">Elige…</option>{almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
      {alm && <>
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="w-full text-body-sm"><caption className="sr-only">Conteo físico</caption><thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Insumo</th><th className="p-3 text-right">Sistema</th><th className="p-3 text-right">Contado</th></tr></thead>
          <tbody>{insumos.map((i) => <tr key={i.id} className="border-t border-outline-variant"><td className="p-3 font-semibold">{i.nombre}</td><td className="p-3 text-right font-label-md">{Number(niveles.data?.find((n) => n.insumoId === i.id)?.cantidad ?? 0)} {i.unidad}</td><td className="p-3 text-right"><input aria-label={`Contado de ${i.nombre}`} inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={vals[i.id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [i.id]: e.target.value }))} className="h-12 w-28 rounded-lg border border-outline-variant px-space-sm text-right font-label-lg" /></td></tr>)}</tbody></table></div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Motivo (opcional)</span><input name="motivo" maxLength={160} placeholder="Cierre de turno, conteo semanal…" className={clases.input} /></label>
        {error && <p role="alert" className="text-error">{error}</p>}<button className={clases.primario}>Aplicar el conteo</button></>}
      {res && <section role="status" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md"><h2 className="font-headline-sm text-headline-sm">Resultado del conteo</h2>
        <ul className="mt-space-xs flex flex-col gap-1">{res.lineas.filter((l) => Number(l.diferencia) !== 0).map((l, k) => <li key={k} className="flex justify-between"><span>{l.nombre}: {Number(l.sistema)} → {Number(l.contado)} {l.unidad}</span><span className={`font-label-md ${Number(l.valor) < 0 ? 'text-error' : 'text-tertiary'}`}>{bs(l.valor)}</span></li>)}{res.lineas.every((l) => Number(l.diferencia) === 0) && <li>Todo cuadra: no hubo diferencias.</li>}</ul>
        <p className="mt-space-sm font-semibold">Diferencia valorizada: {bs(res.valorDiferencia)}</p></section>}
    </form>
  );
}

function Catalogo({ insumos, almacenes, hecho }: { insumos: Insumo[]; almacenes: Almacen[]; hecho(): void }) {
  const { sucursalId } = useRolesActivos(); const [error, setError] = useState<string | null>(null);
  const unidades = useQuery({ queryKey: ['unidades'], queryFn: () => api.get<Unidad[]>('/unidades', sucursalId!), enabled: !!sucursalId, staleTime: Infinity });
  const accion = async (f: () => Promise<unknown>) => { setError(null); try { await f(); hecho(); } catch (e) { setError(mensajeDeError(e)); } };
  const nuevoInsumo = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; void accion(async () => { await api.post('/insumos', { nombre: String(f.get('nombre')).trim(), unidad: String(f.get('unidad')), minimo: num(f.get('minimo')) || 0, categoria: String(f.get('categoria')).trim() || null, perecedero: f.get('perecedero') === 'on' }, sucursalId!); form.reset(); }); };
  const nuevoAlmacen = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; void accion(async () => { await api.post('/almacenes', { nombre: String(f.get('nombre')).trim() }, sucursalId!); form.reset(); }); };
  return (
    <section className="flex flex-col gap-space-md">
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-[2fr_1fr]">
        <form onSubmit={nuevoInsumo} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-2 gap-space-sm items-end"><h2 className="font-headline-sm text-headline-sm col-span-2">Nuevo insumo</h2>
          <label className="flex flex-col gap-space-xs col-span-2"><span className={clases.etiqueta}>Nombre</span><input name="nombre" required maxLength={120} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Unidad</span><select name="unidad" required className={clases.input}>{(unidades.data ?? []).map((u) => <option key={u.codigo} value={u.codigo}>{u.codigo}</option>)}</select></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Stock mínimo</span><input name="minimo" inputMode="decimal" defaultValue="0" className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Categoría</span><input name="categoria" maxLength={60} className={clases.input} /></label>
          <label className="flex items-center gap-space-xs h-12"><input type="checkbox" name="perecedero" className="w-5 h-5" />Perecedero</label>
          <button className={`${clases.primario} col-span-2`}>Crear insumo</button></form>
        <form onSubmit={nuevoAlmacen} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm"><h2 className="font-headline-sm text-headline-sm">Almacenes</h2>
          <ul className="flex flex-col gap-1">{almacenes.map((a) => <li key={a.id} className="flex items-center justify-between gap-space-xs"><span>{a.nombre}</span><button type="button" onClick={() => { const n = prompt('Nuevo nombre del almacén', a.nombre); if (n && n.trim() && n.trim() !== a.nombre) void accion(() => api.patch(`/almacenes/${a.id}`, { nombre: n.trim() }, sucursalId!)); }} className="h-10 px-2 text-primary font-label-md">Renombrar</button></li>)}{almacenes.length === 0 && <li className="text-on-surface-variant">Aún no hay almacenes.</li>}</ul>
          <input name="nombre" required maxLength={60} placeholder="Cocina, Bodega seca, Cámara fría…" aria-label="Nombre del almacén" className={clases.input} /><button className={clases.secundario}>Agregar almacén</button></form>
      </div>
      <ul className="grid grid-cols-1 gap-space-xs lg:grid-cols-2">{insumos.map((i) => (
        <li key={i.id} className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-space-sm flex items-center justify-between gap-space-sm ${i.activo ? '' : 'opacity-60'}`}>
          <div className="min-w-0"><p className="font-semibold truncate">{i.nombre}</p><p className="font-body-sm text-on-surface-variant">{i.unidad} · mínimo {i.minimo}{i.perecedero ? ' · perecedero' : ''}{i.activo ? '' : ' · desactivado'}</p></div>
          <div className="flex gap-space-xs shrink-0">
            <button type="button" onClick={() => { const m = prompt(`Stock mínimo de ${i.nombre} (${i.unidad})`, String(i.minimo)); if (m !== null && !Number.isNaN(Number(m))) void accion(() => api.patch(`/insumos/${i.id}`, { nombre: i.nombre, unidad: i.unidad, minimo: Number(m), categoria: i.categoria, perecedero: i.perecedero, metodoCosto: i.metodoCosto, activo: i.activo }, sucursalId!)); }} className="h-12 px-space-sm rounded-lg border border-outline-variant text-primary">Mínimo</button>
            <button type="button" onClick={() => accion(() => api.patch(`/insumos/${i.id}`, { nombre: i.nombre, unidad: i.unidad, minimo: i.minimo, categoria: i.categoria, perecedero: i.perecedero, metodoCosto: i.metodoCosto, activo: !i.activo }, sucursalId!))} className="h-12 px-space-sm rounded-lg border border-outline-variant text-on-surface-variant">{i.activo ? 'Desactivar' : 'Activar'}</button>
          </div></li>))}</ul>
    </section>
  );
}
