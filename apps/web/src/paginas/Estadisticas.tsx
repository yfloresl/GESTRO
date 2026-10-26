import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';

interface Resumen { ingresos: string; pedidos: number; ticketPromedio: string; costo: string; costoAlimentosPct: string | null; merma: string; minutosPreparacion: string | null; utilidadBruta: string }
interface ResumenRes { desde: string; hasta: string; dias: number; actual: Resumen; anterior: Resumen; variacion: { ingresosPct: string | null; pedidosPct: string | null; ticketPct: string | null }; serie: { fecha: string; ingresos: string; pedidos: number }[] }
interface Ventas { grupo: string; total: string; unidad: string; filas: { clave: string; etiqueta: string; ventas: string; cantidad: string; participacionPct: string }[] }
interface MenuRes { umbralUnidades: string; margenPromedioPct: string | null; resumen: Record<string, number>; platos: { platoId: string; nombre: string; unidades: string; ventas: string; precioPromedio: string; costoPorPorcion: string | null; margenPct: string | null; clase: string }[] }
type ProyRes = { suficiente: false; motivo: string; semanasHistoria: number; minimoSemanas: number } | { suficiente: true; confianza: 'alta' | 'media' | 'baja'; crecimientoSemanalPct: number; semanasHistoria: number; desde: string; costoAlimentosPct: string; comprasEstimadas: string;
  diario: { fecha: string; valor: number; bajo: number; alto: number }[]; semanas: { desde: string; hasta: string; valor: number; bajo: number; alto: number }[]; total: { valor: number; bajo: number; alto: number } };
type EscRes = { suficiente: false; motivo: string } | { suficiente: true; base: { ingresos: string; costo: string; utilidadBruta: string }; escenario: { ingresos: string; costo: string; utilidadBruta: string; ingresosVariacion: number; utilidadVariacion: number }; nota: string };
interface Comparacion { sucursales: (Resumen & { id: string; nombre: string })[] }
type Pestana = 'resumen' | 'ventas' | 'menu' | 'proyeccion' | 'sucursales';

const hoy = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
const sumar = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const corto = (f: string) => `${f.slice(8)}/${f.slice(5, 7)}`;
const CLASES: Record<string, { t: string; c: string; d: string }> = {
  estrella: { t: 'Estrella', c: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', d: 'Muy pedido y con buen margen: protégelo y muéstralo.' },
  caballo: { t: 'Caballo', c: 'bg-secondary-fixed text-on-secondary-fixed-variant', d: 'Muy pedido, margen bajo: revisa receta o precio.' },
  puzzle: { t: 'Puzzle', c: 'bg-primary-fixed text-on-primary-fixed-variant', d: 'Buen margen, poco pedido: dale visibilidad.' },
  perro: { t: 'Perro', c: 'bg-error-container text-on-error-container', d: 'Poco pedido y poco margen: candidato a salir.' },
  sin_receta: { t: 'Sin receta', c: 'bg-surface-container text-on-surface-variant', d: 'Sin receta no se puede medir el margen.' },
};

/** Estadísticas & BI (pantalla 5.10): resumen, ventas, ingeniería de menú, proyección con banda y escenarios, y comparación de sucursales. */
export function Estadisticas() {
  const { sucursalId, esAdmin, roles } = useRolesActivos();
  const finanzas = esAdmin || roles.includes('contador');
  const pestanas: [Pestana, string][] = [['resumen', 'Resumen'], ['ventas', 'Ventas'], ['menu', 'Menú'], ...(finanzas ? ([['proyeccion', 'Proyección']] as [Pestana, string][]) : []), ...(esAdmin ? ([['sucursales', 'Sucursales']] as [Pestana, string][]) : [])];
  const [p, setP] = useState<Pestana>('resumen'); const [dias, setDias] = useState(30);
  if (!sucursalId) return null;
  const hasta = hoy(); const desde = sumar(hasta, -(dias - 1));
  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-end justify-between gap-space-sm"><div><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Estadísticas &amp; BI</h1><p className="font-body-md text-body-md text-on-surface-variant">Ventas, menú y proyecciones con los datos reales del restaurante.</p></div>
        {p !== 'proyeccion' && <div className="flex gap-space-xs" role="group" aria-label="Período">{[7, 30, 90].map((d) => <button key={d} aria-pressed={dias === d} onClick={() => setDias(d)} className={`h-12 px-space-md rounded-full font-label-md ${dias === d ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{d} días</button>)}</div>}</header>
      <div className="flex gap-space-xs overflow-x-auto" role="tablist" aria-label="Secciones">{pestanas.map(([k, n]) => <button key={k} role="tab" aria-selected={p === k} onClick={() => setP(k)} className={`h-12 px-space-md rounded-lg font-semibold whitespace-nowrap ${p === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
      {p === 'resumen' && <ResumenVista desde={desde} hasta={hasta} />}{p === 'ventas' && <VentasVista desde={desde} hasta={hasta} />}{p === 'menu' && <MenuVista desde={desde} hasta={hasta} />}
      {p === 'proyeccion' && <Proyeccion />}{p === 'sucursales' && <Sucursales desde={desde} hasta={hasta} />}
    </div>
  );
}

const Tarjeta = ({ t, v, sub, bueno }: { t: string; v: string; sub?: string | null; bueno?: boolean | null }) => (
  <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md"><p className="font-label-sm uppercase text-on-surface-variant">{t}</p><p className="font-headline-sm text-headline-sm text-primary">{v}</p>
    {sub && <p className={`font-body-sm ${bueno === true ? 'text-tertiary' : bueno === false ? 'text-error' : 'text-on-surface-variant'}`}>{sub}</p>}</div>);
const variacion = (v: string | null) => (v === null ? null : `${Number(v) >= 0 ? '▲' : '▼'} ${Math.abs(Number(v))}% vs. período anterior`);

function Barras({ filas, formato = bs }: { filas: { etiqueta: string; valor: number; extra?: string }[]; formato?: (n: number) => string }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return <ul className="flex flex-col gap-1">{filas.map((f) => <li key={f.etiqueta} className="grid grid-cols-[7rem_1fr_auto] items-center gap-space-sm"><span className="truncate font-body-sm">{f.etiqueta}</span>
    <span className="h-5 rounded bg-surface-container overflow-hidden"><span className="block h-full bg-primary" style={{ width: `${(f.valor / max) * 100}%` }} /></span><span className="font-label-md text-right whitespace-nowrap">{formato(f.valor)}{f.extra ? <span className="text-on-surface-variant font-body-sm"> · {f.extra}</span> : null}</span></li>)}</ul>;
}

function Linea({ puntos, banda }: { puntos: { x: string; y: number; bajo?: number; alto?: number }[]; banda?: boolean }) {
  if (puntos.length < 2) return null;
  const W = 640; const H = 180; const P = 8;
  const max = Math.max(1, ...puntos.map((p) => p.alto ?? p.y));
  const X = (i: number) => P + (i / (puntos.length - 1)) * (W - 2 * P); const Y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const linea = puntos.map((p, i) => `${X(i)},${Y(p.y)}`).join(' ');
  const area = banda ? `${puntos.map((p, i) => `${X(i)},${Y(p.alto ?? p.y)}`).join(' ')} ${[...puntos].reverse().map((p, i) => `${X(puntos.length - 1 - i)},${Y(p.bajo ?? p.y)}`).join(' ')}` : '';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de ingresos por día" className="w-full h-auto">
      {banda && <polygon points={area} className="fill-primary opacity-15" />}
      <polyline points={linea} fill="none" className="stroke-primary" strokeWidth="2" strokeLinejoin="round" />
      <text x={P} y={H - 1} className="fill-on-surface-variant" fontSize="10">{corto(puntos[0].x)}</text><text x={W - P} y={H - 1} textAnchor="end" className="fill-on-surface-variant" fontSize="10">{corto(puntos[puntos.length - 1].x)}</text>
    </svg>
  );
}

function ResumenVista({ desde, hasta }: { desde: string; hasta: string }) {
  const { sucursalId } = useRolesActivos();
  const q = useQuery({ queryKey: ['est-resumen', sucursalId, desde, hasta], queryFn: () => api.get<ResumenRes>(`/estadisticas/resumen?desde=${desde}&hasta=${hasta}`, sucursalId!), enabled: !!sucursalId });
  const r = q.data;
  if (!r) return <p role="status">Cargando…</p>;
  const a = r.actual;
  return (
    <section className="flex flex-col gap-space-md">
      <div className="grid grid-cols-2 gap-gutter md:grid-cols-3 xl:grid-cols-6">
        <Tarjeta t="Ingresos" v={bs(a.ingresos)} sub={variacion(r.variacion.ingresosPct)} bueno={r.variacion.ingresosPct === null ? null : Number(r.variacion.ingresosPct) >= 0} />
        <Tarjeta t="Pedidos cobrados" v={String(a.pedidos)} sub={variacion(r.variacion.pedidosPct)} bueno={r.variacion.pedidosPct === null ? null : Number(r.variacion.pedidosPct) >= 0} />
        <Tarjeta t="Ticket promedio" v={bs(a.ticketPromedio)} sub={variacion(r.variacion.ticketPct)} bueno={r.variacion.ticketPct === null ? null : Number(r.variacion.ticketPct) >= 0} />
        <Tarjeta t="Costo de alimentos" v={a.costoAlimentosPct ? `${a.costoAlimentosPct}%` : '—'} sub={`Costo ${bs(a.costo)}`} />
        <Tarjeta t="Merma" v={bs(a.merma)} sub={Number(a.ingresos) > 0 ? `${((Number(a.merma) / Number(a.ingresos)) * 100).toFixed(1)}% de las ventas` : null} />
        <Tarjeta t="Prep. en cocina" v={a.minutosPreparacion ? `${a.minutosPreparacion} min` : '—'} />
      </div>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md"><h2 className="font-headline-sm text-headline-sm mb-space-xs">Ingresos por día</h2>
        {a.pedidos === 0 ? <p className="text-on-surface-variant">Sin ventas cobradas en este período.</p> : <Linea puntos={r.serie.map((s) => ({ x: s.fecha, y: Number(s.ingresos) }))} />}</div>
    </section>
  );
}

const GRUPOS: [string, string][] = [['hora', 'Hora'], ['dia_semana', 'Día'], ['plato', 'Plato'], ['categoria', 'Categoría'], ['mesero', 'Mesero'], ['canal', 'Canal'], ['tipo', 'Tipo de pedido']];
function VentasVista({ desde, hasta }: { desde: string; hasta: string }) {
  const { sucursalId } = useRolesActivos(); const [grupo, setGrupo] = useState('plato');
  const q = useQuery({ queryKey: ['est-ventas', sucursalId, grupo, desde, hasta], queryFn: () => api.get<Ventas>(`/estadisticas/ventas?grupo=${grupo}&desde=${desde}&hasta=${hasta}`, sucursalId!), enabled: !!sucursalId });
  return (
    <section className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap gap-space-xs">{GRUPOS.map(([k, n]) => <button key={k} aria-pressed={grupo === k} onClick={() => setGrupo(k)} className={`h-12 px-space-md rounded-full font-label-md ${grupo === k ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
      {!q.data ? <p role="status">Cargando…</p> : q.data.filas.length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Sin ventas en este período.</p> : (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md flex flex-col gap-space-sm"><p>Total <strong>{bs(q.data.total)}</strong></p>
          <Barras filas={q.data.filas.map((f) => ({ etiqueta: f.etiqueta, valor: Number(f.ventas), extra: `${Number(f.cantidad)} ${q.data!.unidad} · ${f.participacionPct}%` }))} /></div>)}
    </section>
  );
}

function MenuVista({ desde, hasta }: { desde: string; hasta: string }) {
  const { sucursalId } = useRolesActivos();
  const q = useQuery({ queryKey: ['est-menu', sucursalId, desde, hasta], queryFn: () => api.get<MenuRes>(`/estadisticas/menu?desde=${desde}&hasta=${hasta}`, sucursalId!), enabled: !!sucursalId });
  const m = q.data;
  if (!m) return <p role="status">Cargando…</p>;
  if (!m.platos.length) return <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Sin ventas de platos en este período.</p>;
  return (
    <section className="flex flex-col gap-space-md">
      <div className="grid grid-cols-2 gap-gutter md:grid-cols-5">{Object.entries(CLASES).map(([k, c]) => <div key={k} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-sm"><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase ${c.c}`}>{c.t}</span><p className="font-headline-sm text-headline-sm text-primary mt-1">{m.resumen[k] ?? 0}</p><p className="font-body-sm text-on-surface-variant">{c.d}</p></div>)}</div>
      <p className="font-body-sm text-on-surface-variant">Popular = al menos {m.umbralUnidades} unidades (70 % del promedio por plato). Margen alto = al menos {m.margenPromedioPct ?? '—'} % (promedio ponderado del menú).</p>
      <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="w-full text-body-sm"><caption className="sr-only">Ingeniería de menú</caption><thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Plato</th><th className="p-3 text-right">Unid.</th><th className="p-3 text-right">Ventas</th><th className="p-3 text-right">Costo</th><th className="p-3 text-right">Margen</th><th className="p-3">Clase</th></tr></thead>
        <tbody>{m.platos.map((p) => <tr key={p.platoId} className="border-t border-outline-variant"><td className="p-3 font-semibold">{p.nombre}</td><td className="p-3 text-right">{Number(p.unidades)}</td><td className="p-3 text-right">{bs(p.ventas)}</td><td className="p-3 text-right">{p.costoPorPorcion ? bs(p.costoPorPorcion) : '—'}</td><td className="p-3 text-right">{p.margenPct ? `${p.margenPct}%` : '—'}</td><td className="p-3"><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase ${CLASES[p.clase].c}`}>{CLASES[p.clase].t}</span></td></tr>)}</tbody></table></div>
    </section>
  );
}

function Proyeccion() {
  const { sucursalId } = useRolesActivos(); const [precio, setPrecio] = useState('5'); const [demanda, setDemanda] = useState('0');
  const q = useQuery({ queryKey: ['est-proy', sucursalId], queryFn: () => api.get<ProyRes>('/estadisticas/proyeccion?semanas=4', sucursalId!), enabled: !!sucursalId });
  const e = useQuery({ queryKey: ['est-esc', sucursalId, precio, demanda], queryFn: () => api.get<EscRes>(`/estadisticas/escenario?precio=${Number(precio) || 0}&demanda=${Number(demanda) || 0}`, sucursalId!), enabled: !!sucursalId && q.data?.suficiente === true });
  const p = q.data;
  if (!p) return <p role="status">Cargando…</p>;
  if (!p.suficiente) return <p role="status" className="rounded-xl bg-secondary-fixed text-on-secondary-fixed-variant p-space-md"><strong>Datos insuficientes.</strong> {p.motivo} Mientras tanto, mira las pestañas Resumen y Ventas.</p>;
  const CONF = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja: las semanas pasadas fueron muy dispares' };
  return (
    <section className="flex flex-col gap-space-md">
      <div className="grid grid-cols-2 gap-gutter md:grid-cols-4">
        <Tarjeta t="Ingresos próximas 4 semanas" v={bs(p.total.valor)} sub={`Rango probable ${bs(p.total.bajo)} – ${bs(p.total.alto)}`} />
        <Tarjeta t="Compras estimadas" v={bs(p.comprasEstimadas)} sub={`${p.costoAlimentosPct}% de costo histórico`} />
        <Tarjeta t="Tendencia semanal" v={`${p.crecimientoSemanalPct >= 0 ? '+' : ''}${p.crecimientoSemanalPct}%`} sub={`${p.semanasHistoria} semanas de historia`} />
        <Tarjeta t="Confiabilidad" v={p.confianza === 'alta' ? 'Alta' : p.confianza === 'media' ? 'Media' : 'Baja'} sub={CONF[p.confianza]} bueno={p.confianza === 'alta' ? true : p.confianza === 'baja' ? false : null} />
      </div>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md"><h2 className="font-headline-sm text-headline-sm mb-space-xs">Ingresos proyectados por día (con banda del 80 %)</h2><Linea banda puntos={p.diario.map((d) => ({ x: d.fecha, y: d.valor, bajo: d.bajo, alto: d.alto }))} /></div>
      <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="w-full text-body-sm"><caption className="text-left p-3 font-headline-sm text-headline-sm">Por semana</caption><tbody>{p.semanas.map((w) => <tr key={w.desde} className="border-t border-outline-variant"><td className="p-3 font-semibold">{corto(w.desde)} – {corto(w.hasta)}</td><td className="p-3 text-right">{bs(w.valor)}</td><td className="p-3 text-right text-on-surface-variant">{bs(w.bajo)} – {bs(w.alto)}</td></tr>)}</tbody></table></div>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md flex flex-col gap-space-sm"><h2 className="font-headline-sm text-headline-sm">¿Y si…?</h2>
        <div className="grid grid-cols-2 gap-space-sm"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Cambio de precio (%)</span><input value={precio} onChange={(ev) => setPrecio(ev.target.value)} inputMode="decimal" className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Cambio de demanda (%)</span><input value={demanda} onChange={(ev) => setDemanda(ev.target.value)} inputMode="decimal" className={clases.input} /></label></div>
        {e.data?.suficiente && <><p>Ingresos <strong>{bs(e.data.escenario.ingresos)}</strong> ({e.data.escenario.ingresosVariacion >= 0 ? '+' : ''}{bs(e.data.escenario.ingresosVariacion)}) · utilidad bruta <strong>{bs(e.data.escenario.utilidadBruta)}</strong> ({e.data.escenario.utilidadVariacion >= 0 ? '+' : ''}{bs(e.data.escenario.utilidadVariacion)})</p><p className="font-body-sm text-on-surface-variant">{e.data.nota}</p></>}</div>
    </section>
  );
}

function Sucursales({ desde, hasta }: { desde: string; hasta: string }) {
  const { sucursalId } = useRolesActivos();
  const q = useQuery({ queryKey: ['est-comp', sucursalId, desde, hasta], queryFn: () => api.get<Comparacion>(`/estadisticas/comparacion?desde=${desde}&hasta=${hasta}`, sucursalId!), enabled: !!sucursalId });
  if (!q.data) return <p role="status">Cargando…</p>;
  return (
    <section className="flex flex-col gap-space-md">
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md"><h2 className="font-headline-sm text-headline-sm mb-space-xs">Ingresos por sucursal</h2><Barras filas={q.data.sucursales.map((s) => ({ etiqueta: s.nombre, valor: Number(s.ingresos) }))} /></div>
      <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="w-full text-body-sm"><caption className="sr-only">Comparación de sucursales</caption><thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Sucursal</th><th className="p-3 text-right">Ingresos</th><th className="p-3 text-right">Pedidos</th><th className="p-3 text-right">Ticket</th><th className="p-3 text-right">Costo alim.</th><th className="p-3 text-right">Merma</th></tr></thead>
        <tbody>{q.data.sucursales.map((s) => <tr key={s.id} className="border-t border-outline-variant"><td className="p-3 font-semibold">{s.nombre}</td><td className="p-3 text-right">{bs(s.ingresos)}</td><td className="p-3 text-right">{s.pedidos}</td><td className="p-3 text-right">{bs(s.ticketPromedio)}</td><td className="p-3 text-right">{s.costoAlimentosPct ? `${s.costoAlimentosPct}%` : '—'}</td><td className="p-3 text-right">{bs(s.merma)}</td></tr>)}</tbody></table></div>
    </section>
  );
}
