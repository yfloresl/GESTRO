import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';

interface Plan { fecha: string; platos: { platoId: string; nombre: string; porciones: number; tieneReceta: boolean }[]; insumos: { insumoId: string; insumo: string; unidad: string; requerido: string; stock: string; faltante: string; alcanza: boolean; porAlmacen: { almacen: string; cantidad: string }[] }[]; sinReceta: { platoId: string; nombre: string }[]; hayFaltantes: boolean; costoEstimado: string }
interface Plato { id: string; nombre: string; disponible: boolean }

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date());

/** Plan del día: el jefe de cocina elige platos y porciones y obtiene la lista de insumos contra el stock. */
export function PlanDelDia() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(hoy());
  const platos = useQuery({ queryKey: ['menu-platos', sucursalId], queryFn: () => api.get<Plato[]>('/menu/platos', sucursalId!), enabled: !!sucursalId });
  const plan = useQuery({ queryKey: ['plan', sucursalId, fecha], queryFn: () => api.get<Plan>(`/plan-del-dia/${fecha}`, sucursalId!), enabled: !!sucursalId });
  const [porciones, setPorciones] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null); const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (plan.data) setPorciones(Object.fromEntries(plan.data.platos.map((p) => [p.platoId, String(p.porciones)]))); }, [plan.data]);

  const guardar = async () => {
    setError(null); setGuardando(true);
    const items = Object.entries(porciones).filter(([, v]) => Number(v) > 0).map(([platoId, v]) => ({ platoId, porciones: Math.floor(Number(v)) }));
    try { const r = await api.put<Plan>(`/plan-del-dia/${fecha}`, { items }, sucursalId!); qc.setQueryData(['plan', sucursalId, fecha], r); } catch (e) { setError(mensajeDeError(e)); } finally { setGuardando(false); }
  };
  const { esAdmin, roles } = useRolesActivos();
  const puedeComprar = esAdmin || roles.includes('almacen');
  const [msg, setMsg] = useState<string | null>(null);
  const generar = async () => {
    setError(null); setMsg(null);
    try {
      const r = await api.post<{ ordenes: { proveedor: string; tarde: boolean; esperadaEl: string }[]; sinProveedor: { insumo: string }[] }>(`/plan-del-dia/${fecha}/ordenes-de-compra`, undefined, sucursalId!);
      const tarde = r.ordenes.filter((o) => o.tarde).map((o) => `${o.proveedor} (llega el ${o.esperadaEl})`);
      setMsg(`Se crearon ${r.ordenes.length} orden(es) en borrador, una por proveedor.${tarde.length ? ` Ojo: llegan después de la fecha del plan: ${tarde.join(', ')}.` : ''}${r.sinProveedor.length ? ` Sin proveedor preferido: ${r.sinProveedor.map((s) => s.insumo).join(', ')}.` : ''}`);
    } catch (e) { setError(mensajeDeError(e)); }
  };
  const p = plan.data;
  const faltan = p?.insumos.filter((i) => !i.alcanza) ?? [];

  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-end justify-between gap-space-md"><div><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Plan del día</h1><p className="font-body-md text-body-md text-on-surface-variant">Elige qué se cocinará y cuántas porciones: el sistema calcula los insumos y lo que falta comprar.</p></div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Fecha</span><input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} className={clases.input} /></label></header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="platos" className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm h-fit"><h2 id="platos" className="font-headline-sm text-headline-sm">Platos y porciones</h2>
          {platos.isLoading ? <p role="status">Cargando…</p> : (platos.data ?? []).length === 0 ? <p className="text-on-surface-variant">Carga tus platos en «Menú &amp; Fotos».</p> : (
            <ul className="flex flex-col gap-space-xs">{platos.data!.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-space-sm"><span className={x.disponible ? '' : 'line-through text-on-surface-variant'}>{x.nombre}</span>
                <input aria-label={`Porciones de ${x.nombre}`} inputMode="numeric" pattern="[0-9]*" placeholder="0" value={porciones[x.id] ?? ''} onChange={(e) => setPorciones((v) => ({ ...v, [x.id]: e.target.value.replace(/\D/g, '') }))} className="h-12 w-24 rounded-lg border border-outline-variant px-space-sm text-right font-label-lg" /></li>))}</ul>)}
          <button type="button" disabled={guardando} onClick={guardar} className={clases.primario}>{guardando ? 'Calculando…' : 'Calcular y guardar el plan'}</button>
        </section>
        <section aria-labelledby="insumos" className="flex flex-col gap-space-sm min-w-0"><h2 id="insumos" className="font-headline-sm text-headline-sm">Insumos necesarios</h2>
          {p && p.sinReceta.length > 0 && <p role="alert" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm">Sin receta (no se calculan sus insumos): {p.sinReceta.map((s) => s.nombre).join(', ')}. Complétalas en «Recetas &amp; Costeo».</p>}
          {plan.isLoading ? <p role="status">Cargando…</p> : !p || p.insumos.length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Indica porciones y calcula el plan para ver los insumos.</p> : (
            <>
              <div className={`rounded-xl p-space-md flex flex-wrap items-center justify-between gap-space-sm ${p.hayFaltantes ? 'bg-error-container/50' : 'bg-tertiary-fixed/60'}`}>
                <p className="font-body-md font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">{p.hayFaltantes ? 'warning' : 'check_circle'}</span>{p.hayFaltantes ? `Faltan ${faltan.length} insumo(s) para cumplir el plan` : 'Hay stock suficiente para todo el plan'}</p>
                <p className="font-label-lg">Costo estimado: {bs(p.costoEstimado)}</p>
                {p.hayFaltantes && puedeComprar && <button type="button" onClick={generar} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold">Generar órdenes de compra</button>}</div>
              {msg && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}
              <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="min-w-[34rem] w-full text-body-sm"><caption className="sr-only">Insumos requeridos contra el stock</caption>
                <thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Insumo</th><th className="p-3 text-right">Requerido</th><th className="p-3 text-right">En stock</th><th className="p-3 text-right">Falta</th></tr></thead>
                <tbody>{p.insumos.map((i) => <tr key={i.insumoId} className={`border-t border-outline-variant ${i.alcanza ? '' : 'bg-error-container/20'}`}><td className="p-3 font-semibold">{i.insumo}{i.porAlmacen.length > 1 && <span className="block font-normal text-on-surface-variant">{i.porAlmacen.map((a) => `${a.almacen}: ${Number(a.cantidad)}`).join(' · ')}</span>}</td><td className="p-3 text-right font-label-md">{Number(i.requerido)} {i.unidad}</td><td className="p-3 text-right font-label-md">{Number(i.stock)} {i.unidad}</td><td className={`p-3 text-right font-label-md ${i.alcanza ? 'text-tertiary' : 'text-error font-semibold'}`}>{i.alcanza ? 'OK' : `${Number(i.faltante)} ${i.unidad}`}</td></tr>)}</tbody></table></div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
