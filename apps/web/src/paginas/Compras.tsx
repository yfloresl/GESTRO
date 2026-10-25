import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';

interface Proveedor { id: string; nombre: string; nit: string | null; telefono: string | null; email: string | null; diasEntrega: number; diasCredito: number; activo: boolean }
interface Orden { id: string; estado: 'borrador' | 'enviada' | 'parcial' | 'recibida' | 'cancelada'; proveedor: string; esperadaEl: string; total: string; lineas: number; creada: string }
interface OrdenDet { id: string; estado: Orden['estado']; proveedor: string; esperadaEl: string; total: string; notas: string | null; planDelDia: string | null; lineas: { insumoId: string; insumo: string; unidad: string; pedido: string; recibido: string; pendiente: string; costoUnitario: string }[]; recepciones: { id: string; factura: string | null; total: string; fecha: string; almacen: string }[] }
interface Insumo { id: string; nombre: string; unidad: string; activo: boolean; ultimoCosto: string }
interface Almacen { id: string; nombre: string }
interface Sugerencias { proveedores: { proveedorId: string; proveedor: string; diasEntrega: number; lineas: { insumoId: string; insumo: string; unidad: string; cantidad: string; costoUnitario: string }[] }[]; sinProveedor: { insumoId: string; insumo: string; unidad: string; cantidad: string }[] }
interface PorPagar { id: string; proveedor: string; monto: string; pagado: string; saldo: string; vence: string; dias: number; vencida: boolean; documento: string | null }
type Pestana = 'ordenes' | 'proveedores' | 'sugerencias' | 'pagar';

const ESTADO: Record<Orden['estado'], { t: string; c: string }> = {
  borrador: { t: 'Borrador', c: 'bg-surface-container text-on-surface-variant' }, enviada: { t: 'Enviada', c: 'bg-primary-fixed text-on-primary-fixed-variant' },
  parcial: { t: 'Recibida parcial', c: 'bg-secondary-fixed text-on-secondary-fixed-variant' }, recibida: { t: 'Recibida', c: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' }, cancelada: { t: 'Cancelada', c: 'bg-error-container text-on-error-container' },
};
const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(',', '.'));

/** Compras & Proveedores (pantalla 5.5): órdenes, recepción contra la orden, sugerencias y cuentas por pagar. */
export function Compras() {
  const { sucursalId, esAdmin, roles } = useRolesActivos();
  const compra = esAdmin || roles.includes('almacen');
  const finanzas = esAdmin || roles.includes('contador');
  const [p, setP] = useState<Pestana>(compra ? 'ordenes' : 'pagar');
  const qc = useQueryClient();
  const refrescar = () => { for (const k of ['ordenes', 'proveedores', 'sugerencias', 'por-pagar', 'orden', 'insumos', 'stock-alertas']) void qc.invalidateQueries({ queryKey: [k] }); };
  const pestanas: [Pestana, string][] = [...(compra ? ([['ordenes', 'Órdenes de compra'], ['proveedores', 'Proveedores'], ['sugerencias', 'Sugerencias']] as [Pestana, string][]) : []), ...(finanzas ? ([['pagar', 'Por pagar']] as [Pestana, string][]) : [])];
  if (!sucursalId) return null;
  return (
    <div className="flex flex-col gap-space-lg">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Compras &amp; Proveedores</h1><p className="font-body-md text-body-md text-on-surface-variant">Del plan del día a la orden de compra, la recepción y lo que se debe pagar.</p></header>
      <div className="flex gap-space-xs overflow-x-auto" role="tablist" aria-label="Secciones">{pestanas.map(([k, n]) => <button key={k} role="tab" aria-selected={p === k} onClick={() => setP(k)} className={`h-12 px-space-md rounded-lg font-semibold whitespace-nowrap ${p === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
      {p === 'ordenes' && <Ordenes hecho={refrescar} />}{p === 'proveedores' && <Proveedores hecho={refrescar} />}{p === 'sugerencias' && <SugerenciasVista hecho={refrescar} />}{p === 'pagar' && <PorPagarVista hecho={refrescar} />}
    </div>
  );
}

function Ordenes({ hecho }: { hecho(): void }) {
  const { sucursalId } = useRolesActivos();
  const [estado, setEstado] = useState(''); const [abierta, setAbierta] = useState<string | null>(null); const [nueva, setNueva] = useState(false);
  const q = useQuery({ queryKey: ['ordenes', sucursalId, estado], queryFn: () => api.get<Orden[]>(`/ordenes-de-compra${estado ? `?estado=${estado}` : ''}`, sucursalId!), enabled: !!sucursalId });
  return (
    <section className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-center justify-between gap-space-sm"><div className="flex flex-wrap gap-space-xs">{[['', 'Todas'], ['borrador', 'Borrador'], ['enviada', 'Enviadas'], ['parcial', 'Parciales'], ['recibida', 'Recibidas']].map(([k, n]) => <button key={k} aria-pressed={estado === k} onClick={() => setEstado(k)} className={`h-12 px-space-md rounded-full font-label-md ${estado === k ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
        <button type="button" onClick={() => setNueva(true)} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">add_circle</span>Nueva orden</button></div>
      {q.isLoading ? <p role="status">Cargando…</p> : (q.data ?? []).length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">No hay órdenes. Crea una, o genérala desde «Sugerencias» o el «Plan del día».</p> : (
        <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">{q.data!.map((o) => <li key={o.id}><button type="button" onClick={() => setAbierta(o.id)} className="w-full text-left bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-xs hover:border-primary"><div className="flex items-center justify-between gap-space-sm"><span className="font-headline-sm text-headline-sm truncate">{o.proveedor}</span><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase whitespace-nowrap ${ESTADO[o.estado].c}`}>{ESTADO[o.estado].t}</span></div><p className="font-body-sm text-on-surface-variant">{o.lineas} insumo(s) · llega el {o.esperadaEl}</p><p className="font-label-lg text-primary">{bs(o.total)}</p></button></li>)}</ul>)}
      {abierta && <DetalleOrden id={abierta} cerrar={() => setAbierta(null)} hecho={hecho} />}
      {nueva && <NuevaOrden cerrar={() => setNueva(false)} hecho={() => { setNueva(false); hecho(); }} />}
    </section>
  );
}

function NuevaOrden({ cerrar, hecho }: { cerrar(): void; hecho(): void }) {
  const { sucursalId } = useRolesActivos();
  const proveedores = useQuery({ queryKey: ['proveedores', sucursalId], queryFn: () => api.get<Proveedor[]>('/proveedores', sucursalId!), enabled: !!sucursalId });
  const insumos = useQuery({ queryKey: ['insumos', sucursalId], queryFn: () => api.get<Insumo[]>('/insumos', sucursalId!), enabled: !!sucursalId });
  const [lineas, setLineas] = useState<{ insumoId: string; cantidad: string; costo: string }[]>([{ insumoId: '', cantidad: '', costo: '' }]); const [error, setError] = useState<string | null>(null);
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget);
    try { await api.post('/ordenes-de-compra', { proveedorId: String(f.get('proveedor')), notas: String(f.get('notas') ?? '').trim() || undefined, lineas: lineas.filter((l) => l.insumoId).map((l) => ({ insumoId: l.insumoId, cantidad: num(l.cantidad), costoUnitario: num(l.costo) })) }, sucursalId!); hecho(); } catch (err) { setError(mensajeDeError(err)); }
  };
  const cambiar = (i: number, c: Partial<(typeof lineas)[number]>) => setLineas(lineas.map((l, k) => (k === i ? { ...l, ...c } : l)));
  return (
    <div role="dialog" aria-modal="true" aria-label="Nueva orden de compra" className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <form onSubmit={enviar} onClick={(e) => e.stopPropagation()} className="w-full max-w-xl bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">Nueva orden de compra</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Proveedor</span><select name="proveedor" required className={clases.input}><option value="">Elige…</option>{(proveedores.data ?? []).filter((x) => x.activo).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
        <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Insumos</legend>
          {lineas.map((l, i) => (<div key={i} className="grid grid-cols-[1fr_5rem_5.5rem_2.5rem] gap-space-xs items-center">
            <select aria-label="Insumo" value={l.insumoId} onChange={(e) => cambiar(i, { insumoId: e.target.value, costo: l.costo || Number(insumos.data?.find((x) => x.id === e.target.value)?.ultimoCosto ?? 0).toString() })} className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm min-w-0"><option value="">Elige…</option>{(insumos.data ?? []).filter((x) => x.activo).map((x) => <option key={x.id} value={x.id}>{x.nombre} ({x.unidad})</option>)}</select>
            <input aria-label="Cantidad" placeholder="Cant." inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} className="h-12 rounded-lg border border-outline-variant px-space-sm font-label-lg w-full" />
            <input aria-label="Costo unitario (Bs)" placeholder="Bs c/u" inputMode="decimal" value={l.costo} onChange={(e) => cambiar(i, { costo: e.target.value })} className="h-12 rounded-lg border border-outline-variant px-space-sm font-label-lg w-full" />
            <button type="button" aria-label="Quitar" onClick={() => setLineas(lineas.filter((_, k) => k !== i))} className="w-10 h-12 text-error"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>))}
          <button type="button" onClick={() => setLineas([...lineas, { insumoId: '', cantidad: '', costo: '' }])} className="h-12 rounded-lg border border-dashed border-outline text-primary font-semibold">+ Agregar insumo</button></fieldset>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Notas (opcional)</span><input name="notas" maxLength={300} className={clases.input} /></label>
        {error && <p role="alert" className="text-error">{error}</p>}<button className={clases.primario}>Crear en borrador</button>
      </form>
    </div>
  );
}

function DetalleOrden({ id, cerrar, hecho }: { id: string; cerrar(): void; hecho(): void }) {
  const { sucursalId } = useRolesActivos();
  const q = useQuery({ queryKey: ['orden', sucursalId, id], queryFn: () => api.get<OrdenDet>(`/ordenes-de-compra/${id}`, sucursalId!), enabled: !!sucursalId });
  const almacenes = useQuery({ queryKey: ['almacenes', sucursalId], queryFn: () => api.get<Almacen[]>('/almacenes', sucursalId!), enabled: !!sucursalId });
  const [recibiendo, setRecibiendo] = useState(false); const [error, setError] = useState<string | null>(null); const [alzas, setAlzas] = useState<{ insumo: string; alzaPct: string }[]>([]);
  const o = q.data;
  const accion = async (f: () => Promise<unknown>) => { setError(null); try { await f(); hecho(); } catch (e) { setError(mensajeDeError(e)); } };
  const recibir = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget);
    const lineas = o!.lineas.map((l) => ({ insumoId: l.insumoId, cantidad: num(f.get(`c-${l.insumoId}`)), costoUnitario: f.get(`p-${l.insumoId}`) ? num(f.get(`p-${l.insumoId}`)) : undefined, lote: String(f.get(`l-${l.insumoId}`) ?? '').trim() || undefined, vence: String(f.get(`v-${l.insumoId}`) ?? '') || undefined })).filter((l) => l.cantidad > 0);
    if (!lineas.length) { setError('Escribe la cantidad recibida de al menos un insumo.'); return; }
    try { const r = await api.post<{ alertasDePrecio: { insumo: string; alzaPct: string }[] }>(`/ordenes-de-compra/${id}/recibir`, { almacenId: String(f.get('almacen')), factura: String(f.get('factura') ?? '').trim() || undefined, lineas }, sucursalId!); setAlzas(r.alertasDePrecio); setRecibiendo(false); hecho(); } catch (err) { setError(mensajeDeError(err)); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Orden de compra" className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">{o?.proveedor ?? 'Orden'}</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        {!o ? <p role="status">Cargando…</p> : <>
          <p className="flex flex-wrap items-center gap-space-sm"><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase ${ESTADO[o.estado].c}`}>{ESTADO[o.estado].t}</span><span className="text-on-surface-variant">Llega el {o.esperadaEl}{o.planDelDia ? ` · del plan del ${o.planDelDia}` : ''}</span></p>
          {alzas.length > 0 && <p role="alert" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm">Alza de precio: {alzas.map((a) => `${a.insumo} +${a.alzaPct}%`).join(', ')}.</p>}
          <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="w-full text-body-sm"><caption className="sr-only">Insumos de la orden</caption><thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Insumo</th><th className="p-3 text-right">Pedido</th><th className="p-3 text-right">Recibido</th><th className="p-3 text-right">Costo</th></tr></thead>
            <tbody>{o.lineas.map((l) => <tr key={l.insumoId} className="border-t border-outline-variant"><td className="p-3 font-semibold">{l.insumo}</td><td className="p-3 text-right font-label-md">{Number(l.pedido)} {l.unidad}</td><td className={`p-3 text-right font-label-md ${Number(l.pendiente) > 0 && Number(l.recibido) > 0 ? 'text-secondary' : ''}`}>{Number(l.recibido)}</td><td className="p-3 text-right font-label-md">{bs(l.costoUnitario)}</td></tr>)}</tbody></table></div>
          <p className="font-headline-sm text-headline-sm text-right">Total: <span className="font-label-lg">{bs(o.total)}</span></p>
          {o.recepciones.length > 0 && <section><h3 className={clases.etiqueta}>Recepciones</h3><ul className="mt-space-xs flex flex-col gap-1">{o.recepciones.map((r) => <li key={r.id} className="rounded-lg bg-surface-container p-space-sm flex justify-between"><span>{new Date(r.fecha).toLocaleDateString('es-BO')} · {r.almacen}{r.factura ? ` · fact. ${r.factura}` : ''}</span><span className="font-label-md">{bs(r.total)}</span></li>)}</ul></section>}
          {error && <p role="alert" className="text-error">{error}</p>}
          {o.estado === 'borrador' && <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={() => accion(() => api.post(`/ordenes-de-compra/${id}/cancelar`, undefined, sucursalId!))} className="h-14 rounded-lg border border-error text-error font-semibold">Cancelar orden</button><button type="button" onClick={() => accion(() => api.post(`/ordenes-de-compra/${id}/enviar`, undefined, sucursalId!))} className={clases.primario}>Enviar al proveedor</button></div>}
          {['enviada', 'parcial'].includes(o.estado) && !recibiendo && <div className="grid grid-cols-2 gap-space-sm">{o.estado === 'enviada' && <button type="button" onClick={() => accion(() => api.post(`/ordenes-de-compra/${id}/cancelar`, undefined, sucursalId!))} className="h-14 rounded-lg border border-error text-error font-semibold">Cancelar</button>}<button type="button" onClick={() => setRecibiendo(true)} className={`${clases.primario} ${o.estado === 'parcial' ? 'col-span-2' : ''}`}>Recibir mercadería</button></div>}
          {recibiendo && <form onSubmit={recibir} className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-sm"><h3 className="font-headline-sm text-headline-sm">Recepción</h3>
            <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Almacén donde entra</span><select name="almacen" required className={clases.input}><option value="">Elige…</option>{(almacenes.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
            <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>N° de factura del proveedor (opcional)</span><input name="factura" maxLength={40} className={clases.input} /></label>
            {o.lineas.map((l) => <fieldset key={l.insumoId} className="rounded-lg bg-surface-container-lowest border border-outline-variant p-space-sm grid grid-cols-2 gap-space-xs"><legend className="px-1 font-semibold">{l.insumo} <span className="font-normal text-on-surface-variant">(faltan {Number(l.pendiente)} {l.unidad})</span></legend>
              <input name={`c-${l.insumoId}`} aria-label={`Recibido de ${l.insumo}`} placeholder="Recibido" inputMode="decimal" defaultValue={Number(l.pendiente) > 0 ? String(Number(l.pendiente)) : ''} className="h-12 rounded-lg border border-outline-variant px-space-sm font-label-lg" />
              <input name={`p-${l.insumoId}`} aria-label={`Costo de ${l.insumo}`} placeholder={`Bs c/u (${Number(l.costoUnitario)})`} inputMode="decimal" className="h-12 rounded-lg border border-outline-variant px-space-sm font-label-lg" />
              <input name={`l-${l.insumoId}`} aria-label={`Lote de ${l.insumo}`} placeholder="Lote (opc.)" maxLength={40} className="h-12 rounded-lg border border-outline-variant px-space-sm" /><input name={`v-${l.insumoId}`} aria-label={`Vence ${l.insumo}`} type="date" className="h-12 rounded-lg border border-outline-variant px-space-sm" /></fieldset>)}
            <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={() => setRecibiendo(false)} className="h-14 rounded-lg border border-outline-variant font-semibold">Cancelar</button><button className={clases.primario}>Registrar recepción</button></div></form>}
        </>}
      </div>
    </div>
  );
}

function Proveedores({ hecho }: { hecho(): void }) {
  const { sucursalId } = useRolesActivos(); const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['proveedores', sucursalId], queryFn: () => api.get<Proveedor[]>('/proveedores', sucursalId!), enabled: !!sucursalId });
  const nuevo = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); const form = e.currentTarget; const s = (k: string) => String(f.get(k) ?? '').trim();
    try { await api.post('/proveedores', { nombre: s('nombre'), nit: s('nit') || null, telefono: s('telefono') || null, email: s('email') || null, diasEntrega: num(f.get('entrega')) || 0, diasCredito: num(f.get('credito')) || 0 }, sucursalId!); form.reset(); hecho(); } catch (err) { setError(mensajeDeError(err)); } };
  const alternar = async (p: Proveedor) => { try { await api.patch(`/proveedores/${p.id}`, { nombre: p.nombre, nit: p.nit, telefono: p.telefono, email: p.email, diasEntrega: p.diasEntrega, diasCredito: p.diasCredito, activo: !p.activo }, sucursalId!); hecho(); } catch (err) { setError(mensajeDeError(err)); } };
  return (
    <section className="flex flex-col gap-space-md">{error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <form onSubmit={nuevo} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-2 gap-space-sm md:grid-cols-6 items-end"><h2 className="font-headline-sm text-headline-sm col-span-2 md:col-span-6">Nuevo proveedor</h2>
        <label className="flex flex-col gap-space-xs col-span-2"><span className={clases.etiqueta}>Nombre</span><input name="nombre" required minLength={2} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>NIT</span><input name="nit" className={clases.input} /></label><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Teléfono</span><input name="telefono" inputMode="tel" className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Entrega (días)</span><input name="entrega" type="number" min={0} max={60} defaultValue={1} className={clases.input} /></label><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Crédito (días)</span><input name="credito" type="number" min={0} max={365} defaultValue={0} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs col-span-2 md:col-span-4"><span className={clases.etiqueta}>Correo</span><input name="email" type="email" className={clases.input} /></label><button className={`${clases.primario} col-span-2`}>Agregar</button></form>
      {q.isLoading ? <p role="status">Cargando…</p> : <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2">{(q.data ?? []).map((p) => <li key={p.id} className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex items-center justify-between gap-space-sm ${p.activo ? '' : 'opacity-60'}`}><div className="min-w-0"><p className="font-semibold truncate">{p.nombre}</p><p className="font-body-sm text-on-surface-variant">{[p.nit && `NIT ${p.nit}`, p.telefono, `entrega ${p.diasEntrega} d`, p.diasCredito ? `crédito ${p.diasCredito} d` : 'contado'].filter(Boolean).join(' · ')}</p></div><button type="button" onClick={() => alternar(p)} className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold shrink-0">{p.activo ? 'Desactivar' : 'Activar'}</button></li>)}</ul>}
    </section>
  );
}

function SugerenciasVista({ hecho }: { hecho(): void }) {
  const { sucursalId } = useRolesActivos(); const [error, setError] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['sugerencias', sucursalId], queryFn: () => api.get<Sugerencias>('/compras/sugerencias', sucursalId!), enabled: !!sucursalId });
  const generar = async () => { setError(null); setMsg(null); try { const r = await api.post<{ ordenes: unknown[] }>('/compras/sugerencias/ordenes', undefined, sucursalId!); setMsg(`Se crearon ${r.ordenes.length} orden(es) en borrador. Revísalas en «Órdenes de compra».`); hecho(); } catch (e) { setError(mensajeDeError(e)); } };
  const s = q.data;
  return (
    <section className="flex flex-col gap-space-md">
      <p className="font-body-md text-on-surface-variant">Insumos bajo su stock mínimo, agrupados por su proveedor preferido. Para el plan del día usa «Generar órdenes de compra» en esa pantalla.</p>
      {error && <p role="alert" className="text-error">{error}</p>}{msg && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}
      {q.isLoading ? <p role="status">Cargando…</p> : !s || (s.proveedores.length === 0 && s.sinProveedor.length === 0) ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Nada por comprar: ningún insumo está bajo su mínimo.</p> : <>
        {s.proveedores.map((p) => <div key={p.proveedorId} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><h2 className="font-headline-sm text-headline-sm">{p.proveedor} <span className="font-body-sm font-normal text-on-surface-variant">· entrega en {p.diasEntrega} día(s)</span></h2><ul className="mt-space-xs flex flex-col gap-1">{p.lineas.map((l) => <li key={l.insumoId} className="flex justify-between"><span>{l.insumo}</span><span className="font-label-md">{Number(l.cantidad)} {l.unidad} · {bs(Number(l.cantidad) * Number(l.costoUnitario))}</span></li>)}</ul></div>)}
        {s.proveedores.length > 0 && <button type="button" onClick={generar} className={`${clases.primario} sm:w-auto sm:px-space-lg self-start`}>Crear órdenes en borrador</button>}
        {s.sinProveedor.length > 0 && <div role="alert" className="rounded-xl bg-secondary-fixed text-on-secondary-fixed-variant p-space-md"><p className="font-semibold">Sin proveedor preferido (no se incluyen):</p><p>{s.sinProveedor.map((x) => `${x.insumo} (${Number(x.cantidad)} ${x.unidad})`).join(', ')}. Asigna uno en «Inventario → Insumos y almacenes».</p></div>}
      </>}
    </section>
  );
}

function PorPagarVista({ hecho }: { hecho(): void }) {
  const { sucursalId, esAdmin, roles } = useRolesActivos(); const puede = esAdmin || roles.includes('contador'); const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['por-pagar', sucursalId], queryFn: () => api.get<PorPagar[]>('/por-pagar', sucursalId!), enabled: !!sucursalId });
  const pagar = async (c: PorPagar) => { const v = prompt(`Monto a pagar a ${c.proveedor} (saldo Bs ${c.saldo})`, c.saldo); if (v === null) return; setError(null); try { await api.post(`/por-pagar/${c.id}/pagar`, { monto: Number(v.replace(',', '.')) }, sucursalId!); hecho(); } catch (e) { setError(mensajeDeError(e)); } };
  const total = (q.data ?? []).reduce((t, c) => t + Number(c.saldo), 0);
  return (
    <section className="flex flex-col gap-space-sm">{error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <p className="font-headline-sm text-headline-sm">Saldo por pagar: <span className="font-label-lg text-primary">{bs(total)}</span></p>
      {q.isLoading ? <p role="status">Cargando…</p> : (q.data ?? []).length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">No debes nada a tus proveedores. Las cuentas nacen al recibir mercadería.</p> : (
        <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2">{q.data!.map((c) => <li key={c.id} className={`border rounded-xl p-space-md flex items-center justify-between gap-space-sm ${c.vencida ? 'bg-error-container/30 border-error-container' : 'bg-surface-container-lowest border-outline-variant'}`}><div className="min-w-0"><p className="font-semibold truncate">{c.proveedor}{c.documento ? ` · ${c.documento}` : ''}</p><p className={`font-body-sm ${c.vencida ? 'text-error font-semibold' : 'text-on-surface-variant'}`}>{c.vencida ? `Vencida hace ${-c.dias} d` : c.dias === 0 ? 'Vence hoy' : `Vence en ${c.dias} d`} ({c.vence}) · de {bs(c.monto)}</p></div><div className="text-right shrink-0"><p className="font-label-lg text-primary">{bs(c.saldo)}</p>{puede && <button type="button" onClick={() => pagar(c)} className="mt-1 h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold">Pagar</button>}</div></li>)}</ul>)}
    </section>
  );
}
