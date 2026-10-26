import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';

interface Cuenta { id: string; codigo: string; nombre: string; tipo: string; aceptaAsientos: boolean; activa: boolean; claveDelSistema: string | null; codigoPadre: string | null; conMovimientos: boolean }
interface Fila { id: string; numero: number | null; fecha: string; glosa: string; origen: string; publicado: boolean; esAnulacion: boolean; contrarrestado: boolean; total: string }
interface Detalle { id: string; numero: number | null; fecha: string; glosa: string; origen: string; publicado: boolean; anulaA: string | null; lineas: { cuenta: string; nombre: string; debe: string; haber: string; centroCosto: string | null }[] }
interface Resultados { cuentas: { codigo: string; nombre: string; tipo: string; saldo: string }[]; ingresos: string; costos: string; utilidadBruta: string; gastos: string; resultado: string; margenBrutoPct: string | null }
interface Impuestos { tasaIva: string; tasaIt: string; debitoFiscal: string; creditoFiscal: string; ivaAPagar: string; baseIt: string; itDelPeriodo: string }
interface Balance { activo: { codigo: string; nombre: string; saldo: string }[]; pasivo: { codigo: string; nombre: string; saldo: string }[]; patrimonio: { codigo: string; nombre: string; saldo: string }[]; resultadoDelEjercicio: string; totalActivo: string; totalPasivo: string; totalPatrimonio: string; cuadra: boolean }
interface Periodo { anio: number; mes: number; cerrado: boolean; cerradoEl: string | null; asientos: number }
type Pestana = 'resumen' | 'asientos' | 'cuentas' | 'reportes' | 'periodos';

const ORIGEN: Record<string, string> = { manual: 'Manual', venta: 'Venta', costo_consumo: 'Costo de ventas', compra: 'Compra', compra_directa: 'Compra al contado', pago_proveedor: 'Pago a proveedor', cobro_cuenta: 'Cobro de cuenta', evento_pago: 'Cobro de evento', evento_cierre: 'Evento realizado', costo_evento: 'Costo de evento', merma: 'Merma', ajuste_inventario: 'Ajuste de inventario' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const num = (v: FormDataEntryValue | string | null) => Number(String(v ?? '').replace(',', '.'));
const hoy = () => new Date().toISOString().slice(0, 10);
const primeroDelMes = () => `${hoy().slice(0, 8)}01`;
const refrescarTodo = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ['conta'] });

/** Contabilidad & Libros (pantalla 5.8): resultados, asientos, plan de cuentas, reportes y cierre de períodos. */
export function Contabilidad() {
  const { sucursalId } = useRolesActivos();
  const [p, setP] = useState<Pestana>('resumen');
  if (!sucursalId) return null;
  const pestanas: [Pestana, string][] = [['resumen', 'Resumen'], ['asientos', 'Asientos'], ['cuentas', 'Plan de cuentas'], ['reportes', 'Reportes'], ['periodos', 'Períodos e impuestos']];
  return (
    <div className="flex flex-col gap-space-lg">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Contabilidad &amp; Libros</h1><p className="font-body-md text-body-md text-on-surface-variant">Las ventas, compras y mermas generan sus asientos solas. Un asiento publicado no se edita: se corrige con otro que lo contrarresta.</p></header>
      <div className="flex gap-space-xs overflow-x-auto" role="tablist" aria-label="Secciones">{pestanas.map(([k, n]) => <button key={k} role="tab" aria-selected={p === k} onClick={() => setP(k)} className={`h-12 px-space-md rounded-lg font-semibold whitespace-nowrap ${p === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
      {p === 'resumen' && <Resumen />}{p === 'asientos' && <Asientos />}{p === 'cuentas' && <PlanDeCuentas />}{p === 'reportes' && <Reportes />}{p === 'periodos' && <Periodos />}
    </div>
  );
}

function Rango({ desde, hasta, set }: { desde: string; hasta: string; set(d: string, h: string): void }) {
  return (
    <div className="flex flex-wrap items-end gap-space-sm">
      <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Desde</span><input type="date" value={desde} onChange={(e) => set(e.target.value, hasta)} className={clases.input} /></label>
      <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Hasta</span><input type="date" value={hasta} onChange={(e) => set(desde, e.target.value)} className={clases.input} /></label>
    </div>
  );
}

const Tarjeta = ({ t, v, destacar }: { t: string; v: string; destacar?: boolean }) => <div className={`rounded-xl border p-space-md ${destacar ? 'bg-primary-container text-on-primary border-primary-container' : 'bg-surface-container-lowest border-outline-variant'}`}><p className="font-label-sm uppercase opacity-80">{t}</p><p className="font-headline-sm text-headline-sm">{v}</p></div>;

function Resumen() {
  const { sucursalId } = useRolesActivos();
  const [r, setR] = useState({ desde: primeroDelMes(), hasta: hoy() });
  const q = `?desde=${r.desde}&hasta=${r.hasta}`;
  const res = useQuery({ queryKey: ['conta', 'resultados', sucursalId, r], queryFn: () => api.get<Resultados>(`/contabilidad/reportes/resultados${q}`, sucursalId!), enabled: !!sucursalId });
  const bal = useQuery({ queryKey: ['conta', 'balance', sucursalId, r.hasta], queryFn: () => api.get<Balance>(`/contabilidad/reportes/balance?hasta=${r.hasta}`, sucursalId!), enabled: !!sucursalId });
  const imp = useQuery({ queryKey: ['conta', 'impuestos', sucursalId, r], queryFn: () => api.get<Impuestos>(`/contabilidad/reportes/impuestos${q}`, sucursalId!), enabled: !!sucursalId });
  const e = res.data;
  return (
    <section className="flex flex-col gap-space-md">
      <Rango desde={r.desde} hasta={r.hasta} set={(desde, hasta) => setR({ desde, hasta })} />
      {res.isLoading ? <p role="status">Cargando…</p> : e && <>
        <div className="grid grid-cols-2 gap-gutter md:grid-cols-5"><Tarjeta t="Ingresos" v={bs(e.ingresos)} /><Tarjeta t="Costo de ventas" v={bs(e.costos)} /><Tarjeta t="Utilidad bruta" v={`${bs(e.utilidadBruta)}${e.margenBrutoPct ? ` · ${e.margenBrutoPct}%` : ''}`} /><Tarjeta t="Gastos" v={bs(e.gastos)} /><Tarjeta t="Resultado" v={bs(e.resultado)} destacar /></div>
        <Tabla titulo="Estado de resultados" filas={e.cuentas.map((c) => [c.codigo, c.nombre, bs(c.saldo)])} vacio="Aún no hay movimientos en este rango." />
      </>}
      {bal.data && <div className="flex flex-col gap-space-xs"><h2 className="font-headline-sm text-headline-sm">Balance al {r.hasta}</h2>
        <p className={bal.data.cuadra ? 'text-tertiary' : 'text-error'} role="status">{bal.data.cuadra ? 'Cuadra: Activo = Pasivo + Patrimonio.' : 'No cuadra: revisa los asientos.'}</p>
        <div className="grid grid-cols-1 gap-gutter md:grid-cols-3"><Tarjeta t="Activo" v={bs(bal.data.totalActivo)} /><Tarjeta t="Pasivo" v={bs(bal.data.totalPasivo)} /><Tarjeta t="Patrimonio (con resultado)" v={bs(bal.data.totalPatrimonio)} /></div></div>}
      {imp.data && <p className="rounded-xl bg-secondary-fixed text-on-secondary-fixed-variant p-space-md">IVA del período (referencial): débito {bs(imp.data.debitoFiscal)} − crédito {bs(imp.data.creditoFiscal)} = <strong>{bs(imp.data.ivaAPagar)}</strong>. IT {imp.data.tasaIt}% sobre {bs(imp.data.baseIt)} = <strong>{bs(imp.data.itDelPeriodo)}</strong>. Las tasas son parámetros de la sucursal; la cifra final la valida tu contador.</p>}
    </section>
  );
}

function Tabla({ titulo, filas, vacio, cabecera }: { titulo: string; filas: string[][]; vacio?: string; cabecera?: string[] }) {
  return (
    <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl">
      <table className="w-full text-body-sm"><caption className="text-left p-3 font-headline-sm text-headline-sm">{titulo}</caption>
        {cabecera && <thead><tr className="text-left text-on-surface-variant font-label-sm uppercase">{cabecera.map((c, i) => <th key={c} className={`p-3 ${i >= 2 ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>}
        <tbody>{filas.length === 0 ? <tr><td className="p-3 text-on-surface-variant">{vacio ?? 'Sin datos.'}</td></tr> : filas.map((f, i) => <tr key={i} className="border-t border-outline-variant">{f.map((c, k) => <td key={k} className={`p-3 ${k >= 2 ? 'text-right font-label-md' : ''}`}>{c}</td>)}</tr>)}</tbody></table>
    </div>
  );
}

function Asientos() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const [estado, setEstado] = useState(''); const [abierto, setAbierto] = useState<string | null>(null); const [nuevo, setNuevo] = useState(false);
  const q = useQuery({ queryKey: ['conta', 'asientos', sucursalId, estado], queryFn: () => api.get<Fila[]>(`/contabilidad/asientos${estado ? `?estado=${estado}` : ''}`, sucursalId!), enabled: !!sucursalId });
  return (
    <section className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-center justify-between gap-space-sm"><div className="flex flex-wrap gap-space-xs">{[['', 'Todos'], ['borrador', 'Borradores'], ['publicado', 'Publicados']].map(([k, n]) => <button key={k} aria-pressed={estado === k} onClick={() => setEstado(k)} className={`h-12 px-space-md rounded-full font-label-md ${estado === k ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
        <button type="button" onClick={() => setNuevo(true)} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">add_circle</span>Nuevo asiento</button></div>
      {q.isLoading ? <p role="status">Cargando…</p> : (q.data ?? []).length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Todavía no hay asientos. Nacen solos al cobrar, comprar o registrar mermas.</p> : (
        <ul className="flex flex-col gap-space-xs">{q.data!.map((a) => <li key={a.id}><button type="button" onClick={() => setAbierto(a.id)} className="w-full text-left bg-surface-container-lowest border border-outline-variant rounded-xl p-space-sm px-space-md flex items-center justify-between gap-space-sm hover:border-primary">
          <span className="min-w-0"><span className="font-semibold">{a.numero !== null ? `N° ${a.numero}` : 'Borrador'} · {a.glosa}</span><span className="block font-body-sm text-on-surface-variant">{a.fecha} · {ORIGEN[a.origen] ?? a.origen}{a.esAnulacion ? ' · anulación' : ''}{a.contrarrestado ? ' · contrarrestado' : ''}</span></span>
          <span className="font-label-lg text-primary whitespace-nowrap">{bs(a.total)}</span></button></li>)}</ul>)}
      {abierto && <DetalleAsiento id={abierto} cerrar={() => setAbierto(null)} hecho={() => { void refrescarTodo(qc); }} />}
      {nuevo && <NuevoAsiento cerrar={() => setNuevo(false)} hecho={() => { setNuevo(false); void refrescarTodo(qc); }} />}
    </section>
  );
}

function DetalleAsiento({ id, cerrar, hecho }: { id: string; cerrar(): void; hecho(): void }) {
  const { sucursalId } = useRolesActivos();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['conta', 'asiento', sucursalId, id], queryFn: () => api.get<Detalle>(`/contabilidad/asientos/${id}`, sucursalId!), enabled: !!sucursalId });
  const lista = useQuery({ queryKey: ['conta', 'asientos', sucursalId, ''], queryFn: () => api.get<Fila[]>('/contabilidad/asientos', sucursalId!), enabled: !!sucursalId });
  const a = q.data; const fila = lista.data?.find((x) => x.id === id);
  const accion = async (f: () => Promise<unknown>, cierra = true) => { setError(null); try { await f(); hecho(); if (cierra) cerrar(); } catch (e) { setError(mensajeDeError(e)); } };
  const contrarrestar = () => { const motivo = prompt('Motivo de la anulación (opcional)') ?? undefined; if (motivo === null) return; void accion(() => api.post(`/contabilidad/asientos/${id}/contrarrestar`, motivo ? { motivo } : {}, sucursalId!)); };
  return (
    <div role="dialog" aria-modal="true" aria-label="Asiento" className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">{a ? (a.numero !== null ? `Asiento N° ${a.numero}` : 'Borrador') : 'Asiento'}</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        {!a ? <p role="status">Cargando…</p> : <>
          <p className="text-on-surface-variant">{a.fecha} · {ORIGEN[a.origen] ?? a.origen} — {a.glosa}</p>
          <Tabla titulo="Líneas" cabecera={['Cuenta', 'Nombre', 'Debe', 'Haber']} filas={a.lineas.map((l) => [l.cuenta, l.nombre, Number(l.debe) ? bs(l.debe) : '', Number(l.haber) ? bs(l.haber) : ''])} />
          {error && <p role="alert" className="text-error">{error}</p>}
          {!a.publicado && <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={() => accion(() => api.del(`/contabilidad/asientos/${id}`, undefined, sucursalId!))} className="h-14 rounded-lg border border-error text-error font-semibold">Borrar borrador</button><button type="button" onClick={() => accion(() => api.post(`/contabilidad/asientos/${id}/publicar`, undefined, sucursalId!))} className={clases.primario}>Publicar</button></div>}
          {a.publicado && !a.anulaA && fila && !fila.contrarrestado && <button type="button" onClick={contrarrestar} className="h-14 rounded-lg border border-error text-error font-semibold">Contrarrestar (anular con otro asiento)</button>}
          {a.publicado && <p className="font-body-sm text-on-surface-variant">Un asiento publicado no se edita ni se borra.</p>}
        </>}
      </div>
    </div>
  );
}

function NuevoAsiento({ cerrar, hecho }: { cerrar(): void; hecho(): void }) {
  const { sucursalId } = useRolesActivos();
  const cuentas = useQuery({ queryKey: ['conta', 'cuentas', sucursalId], queryFn: () => api.get<Cuenta[]>('/contabilidad/cuentas', sucursalId!), enabled: !!sucursalId });
  const [lineas, setLineas] = useState<{ cuenta: string; debe: string; haber: string }[]>([{ cuenta: '', debe: '', haber: '' }, { cuenta: '', debe: '', haber: '' }]);
  const [error, setError] = useState<string | null>(null);
  const cambiar = (i: number, c: Partial<(typeof lineas)[number]>) => setLineas(lineas.map((l, k) => (k === i ? { ...l, ...c } : l)));
  const d = lineas.reduce((s, l) => s + num(l.debe), 0); const h = lineas.reduce((s, l) => s + num(l.haber), 0);
  const cuadra = Math.abs(d - h) < 0.005 && d > 0;
  const guardar = async (e: FormEvent<HTMLFormElement>, publicar: boolean) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget.form ?? (e.currentTarget as HTMLFormElement));
    try {
      const r = await api.post<{ id: string }>('/contabilidad/asientos', { fecha: String(f.get('fecha')), glosa: String(f.get('glosa')).trim(), lineas: lineas.filter((l) => l.cuenta).map((l) => ({ cuenta: l.cuenta, debe: num(l.debe) || 0, haber: num(l.haber) || 0 })) }, sucursalId!);
      if (publicar) await api.post(`/contabilidad/asientos/${r.id}/publicar`, undefined, sucursalId!);
      hecho();
    } catch (err) { setError(mensajeDeError(err)); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Nuevo asiento" className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <form onSubmit={(e) => guardar(e, false)} onClick={(e) => e.stopPropagation()} className="w-full max-w-xl bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">Nuevo asiento manual</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Fecha</span><input name="fecha" type="date" defaultValue={hoy()} required className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Glosa</span><input name="glosa" required minLength={3} maxLength={200} className={clases.input} /></label>
        <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Líneas</legend>
          {lineas.map((l, i) => (<div key={i} className="grid grid-cols-[1fr_5.5rem_5.5rem_2.5rem] gap-space-xs items-center">
            <select aria-label="Cuenta" value={l.cuenta} onChange={(e) => cambiar(i, { cuenta: e.target.value })} className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm min-w-0"><option value="">Cuenta…</option>{(cuentas.data ?? []).filter((c) => c.aceptaAsientos && c.activa).map((c) => <option key={c.id} value={c.codigo}>{c.codigo} {c.nombre}</option>)}</select>
            <input aria-label="Debe" placeholder="Debe" inputMode="decimal" value={l.debe} onChange={(e) => cambiar(i, { debe: e.target.value, haber: e.target.value ? '' : l.haber })} className="h-12 rounded-lg border border-outline-variant px-space-sm font-label-lg w-full" />
            <input aria-label="Haber" placeholder="Haber" inputMode="decimal" value={l.haber} onChange={(e) => cambiar(i, { haber: e.target.value, debe: e.target.value ? '' : l.debe })} className="h-12 rounded-lg border border-outline-variant px-space-sm font-label-lg w-full" />
            <button type="button" aria-label="Quitar línea" onClick={() => setLineas(lineas.filter((_, k) => k !== i))} disabled={lineas.length <= 2} className="w-10 h-12 text-error disabled:opacity-30"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>))}
          <button type="button" onClick={() => setLineas([...lineas, { cuenta: '', debe: '', haber: '' }])} className="h-12 rounded-lg border border-dashed border-outline text-primary font-semibold">+ Agregar línea</button></fieldset>
        <p role="status" className={cuadra ? 'text-tertiary' : 'text-on-surface-variant'}>Debe {bs(d)} · Haber {bs(h)} {cuadra ? '· cuadra' : d || h ? `· diferencia ${bs(Math.abs(d - h))}` : ''}</p>
        {error && <p role="alert" className="text-error">{error}</p>}
        <div className="grid grid-cols-2 gap-space-sm"><button className="h-14 rounded-lg border border-outline-variant font-semibold">Guardar borrador</button><button type="button" disabled={!cuadra} onClick={(e) => guardar(e as unknown as FormEvent<HTMLFormElement>, true)} className={`${clases.primario} disabled:opacity-50`}>Guardar y publicar</button></div>
      </form>
    </div>
  );
}

function PlanDeCuentas() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient(); const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['conta', 'cuentas', sucursalId], queryFn: () => api.get<Cuenta[]>('/contabilidad/cuentas', sucursalId!), enabled: !!sucursalId });
  const nueva = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); const form = e.currentTarget; const s = (k: string) => String(f.get(k) ?? '').trim();
    try { await api.post('/contabilidad/cuentas', { codigo: s('codigo'), nombre: s('nombre'), tipo: s('tipo'), codigoPadre: s('padre') || null }, sucursalId!); form.reset(); void refrescarTodo(qc); } catch (err) { setError(mensajeDeError(err)); }
  };
  const alternar = async (c: Cuenta) => { setError(null); try { await api.patch(`/contabilidad/cuentas/${c.id}`, { activa: !c.activa }, sucursalId!); void refrescarTodo(qc); } catch (err) { setError(mensajeDeError(err)); } };
  return (
    <section className="flex flex-col gap-space-md">{error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <form onSubmit={nueva} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-2 gap-space-sm md:grid-cols-5 items-end"><h2 className="font-headline-sm text-headline-sm col-span-2 md:col-span-5">Nueva cuenta</h2>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Código</span><input name="codigo" required placeholder="5.2.05" className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs md:col-span-2"><span className={clases.etiqueta}>Nombre</span><input name="nombre" required minLength={2} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Tipo</span><select name="tipo" required className={clases.input}>{['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto'].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Cuenta padre</span><select name="padre" className={clases.input}><option value="">(ninguna)</option>{(q.data ?? []).filter((c) => !c.conMovimientos).map((c) => <option key={c.id} value={c.codigo}>{c.codigo} {c.nombre}</option>)}</select></label>
        <button className={`${clases.primario} col-span-2 md:col-span-5`}>Agregar cuenta</button></form>
      {q.isLoading ? <p role="status">Cargando…</p> : <ul className="flex flex-col gap-1">{(q.data ?? []).map((c) => <li key={c.id} style={{ paddingLeft: `${(c.codigo.split('.').length - 1) * 1.25}rem` }} className={`flex items-center justify-between gap-space-sm rounded-lg bg-surface-container-lowest border border-outline-variant p-space-sm ${c.activa ? '' : 'opacity-60'}`}>
        <span className={c.aceptaAsientos ? '' : 'font-bold'}>{c.codigo} · {c.nombre} <span className="font-body-sm text-on-surface-variant">({c.tipo}{c.claveDelSistema ? ' · del sistema' : ''})</span></span>
        {c.aceptaAsientos && !c.claveDelSistema && <button type="button" onClick={() => alternar(c)} className="h-12 px-space-sm rounded-lg border border-outline-variant font-label-md">{c.activa ? 'Desactivar' : 'Activar'}</button>}</li>)}</ul>}
    </section>
  );
}

type Reporte = 'comprobacion' | 'mayor' | 'flujo' | 'ventas' | 'compras';
function Reportes() {
  const { sucursalId } = useRolesActivos();
  const [rep, setRep] = useState<Reporte>('comprobacion'); const [r, setR] = useState({ desde: primeroDelMes(), hasta: hoy() }); const [cuenta, setCuenta] = useState('1.1.01');
  const cuentas = useQuery({ queryKey: ['conta', 'cuentas', sucursalId], queryFn: () => api.get<Cuenta[]>('/contabilidad/cuentas', sucursalId!), enabled: !!sucursalId });
  const ruta = rep === 'mayor' ? `/contabilidad/reportes/mayor/${cuenta}` : rep === 'flujo' ? '/contabilidad/reportes/flujo-de-caja' : rep === 'ventas' ? '/contabilidad/reportes/libro-de-ventas' : rep === 'compras' ? '/contabilidad/reportes/libro-de-compras' : '/contabilidad/reportes/comprobacion';
  const q = useQuery({ queryKey: ['conta', 'reporte', sucursalId, rep, cuenta, r], queryFn: () => api.get<Record<string, unknown>>(`${ruta}?desde=${r.desde}&hasta=${r.hasta}`, sucursalId!), enabled: !!sucursalId });
  const d = q.data as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <section className="flex flex-col gap-space-md">
      <div className="flex flex-wrap gap-space-xs">{([['comprobacion', 'Sumas y saldos'], ['mayor', 'Libro mayor'], ['flujo', 'Flujo de caja'], ['ventas', 'Libro de ventas IVA'], ['compras', 'Libro de compras IVA']] as [Reporte, string][]).map(([k, n]) => <button key={k} aria-pressed={rep === k} onClick={() => setRep(k)} className={`h-12 px-space-md rounded-full font-label-md ${rep === k ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
      <div className="flex flex-wrap items-end gap-space-sm"><Rango desde={r.desde} hasta={r.hasta} set={(desde, hasta) => setR({ desde, hasta })} />
        {rep === 'mayor' && <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Cuenta</span><select value={cuenta} onChange={(e) => setCuenta(e.target.value)} className={clases.input}>{(cuentas.data ?? []).filter((c) => c.aceptaAsientos).map((c) => <option key={c.id} value={c.codigo}>{c.codigo} {c.nombre}</option>)}</select></label>}</div>
      {q.isLoading || !d ? <p role="status">Cargando…</p> : <>
        {rep === 'comprobacion' && <><Tabla titulo="Balance de comprobación de sumas y saldos" cabecera={['Código', 'Cuenta', 'Debe', 'Haber', 'Deudor', 'Acreedor']} filas={d.filas.map((f: Record<string, string>) => [f.codigo, f.nombre, bs(f.debe), bs(f.haber), bs(f.deudor), bs(f.acreedor)])} vacio="Sin movimientos." />
          <p role="status" className={d.cuadra ? 'text-tertiary' : 'text-error'}>Totales: debe {bs(d.totalDebe)} · haber {bs(d.totalHaber)} — {d.cuadra ? 'cuadra' : 'NO cuadra'}</p></>}
        {rep === 'mayor' && <><p className="text-on-surface-variant">Saldo inicial {bs(d.saldoInicial)} · saldo final <strong>{bs(d.saldoFinal)}</strong></p><Tabla titulo={`${d.codigo} ${d.nombre}`} cabecera={['N°', 'Fecha · glosa', 'Debe', 'Haber', 'Saldo']} filas={d.movimientos.map((m: Record<string, string>) => [String(m.numero), `${m.fecha} · ${m.glosa}`, Number(m.debe) ? bs(m.debe) : '', Number(m.haber) ? bs(m.haber) : '', bs(m.saldo)])} vacio="Sin movimientos." /></>}
        {rep === 'flujo' && <><div className="grid grid-cols-2 gap-gutter md:grid-cols-4"><Tarjeta t="Saldo inicial" v={bs(d.saldoInicial)} /><Tarjeta t="Entradas" v={bs(d.entradas)} /><Tarjeta t="Salidas" v={bs(d.salidas)} /><Tarjeta t="Saldo final" v={bs(d.saldoFinal)} destacar /></div>
          <Tabla titulo="Caja y bancos por origen" cabecera={['Origen', '', 'Entradas', 'Salidas']} filas={d.porOrigen.map((o: Record<string, string>) => [ORIGEN[o.origen] ?? o.origen, '', bs(o.entradas), bs(o.salidas)])} vacio="Sin movimientos." /></>}
        {(rep === 'ventas' || rep === 'compras') && <><p className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm">{d.nota}</p><Tabla titulo={rep === 'ventas' ? 'Libro de ventas (débito fiscal)' : 'Libro de compras (crédito fiscal)'} cabecera={['Fecha', 'Detalle', 'Importe', 'IVA']} filas={d.filas.map((f: Record<string, string>) => [f.fecha, `${f.proveedor ? `${f.proveedor} · ` : ''}${f.factura ? `Fact. ${f.factura} · ` : ''}${f.glosa}`, bs(f.importe), bs(f.iva)])} vacio="Sin registros en el rango." /><p className="font-label-lg">Total IVA: {bs(d.totalIva)}</p></>}
      </>}
    </section>
  );
}

function Periodos() {
  const { sucursalId, roles, esAdmin } = useRolesActivos();
  const qc = useQueryClient(); const [error, setError] = useState<string | null>(null);
  const ahora = new Date(); const [anio, setAnio] = useState(ahora.getFullYear()); const [mes, setMes] = useState(ahora.getMonth() + 1);
  const q = useQuery({ queryKey: ['conta', 'periodos', sucursalId], queryFn: () => api.get<Periodo[]>('/contabilidad/periodos', sucursalId!), enabled: !!sucursalId });
  const tasas = useQuery({ queryKey: ['conta', 'tasas', sucursalId], queryFn: () => api.get<{ iva: number; it: number }>('/contabilidad/tasas', sucursalId!), enabled: !!sucursalId });
  const esDueno = roles.includes('owner');
  const accion = async (f: () => Promise<unknown>) => { setError(null); try { await f(); void refrescarTodo(qc); } catch (e) { setError(mensajeDeError(e)); } };
  const guardarTasas = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); void accion(() => api.put('/contabilidad/tasas', { iva: num(f.get('iva')), it: num(f.get('it')) }, sucursalId!)); };
  return (
    <section className="flex flex-col gap-space-md">{error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-wrap items-end gap-space-sm"><h2 className="font-headline-sm text-headline-sm w-full">Cerrar un período</h2>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Mes</span><select value={mes} onChange={(e) => setMes(Number(e.target.value))} className={clases.input}>{MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Año</span><input type="number" value={anio} min={2000} max={2100} onChange={(e) => setAnio(Number(e.target.value))} className={clases.input} /></label>
        <button type="button" onClick={() => { if (confirm(`¿Cerrar ${MESES[mes - 1]} de ${anio}? No se podrán registrar asientos en ese mes.`)) void accion(() => api.post('/contabilidad/periodos/cerrar', { anio, mes }, sucursalId!)); }} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold">Cerrar período</button></div>
      <ul className="flex flex-col gap-space-xs">{(q.data ?? []).map((p) => <li key={`${p.anio}-${p.mes}`} className="flex items-center justify-between gap-space-sm rounded-xl bg-surface-container-lowest border border-outline-variant p-space-sm px-space-md"><span className="font-semibold capitalize">{MESES[p.mes - 1]} {p.anio} <span className="font-body-sm font-normal text-on-surface-variant">· {p.asientos} asiento(s) · {p.cerrado ? 'cerrado' : 'abierto'}</span></span>
        {p.cerrado && esDueno && <button type="button" onClick={() => accion(() => api.post('/contabilidad/periodos/reabrir', { anio: p.anio, mes: p.mes }, sucursalId!))} className="h-12 px-space-sm rounded-lg border border-outline-variant font-label-md">Reabrir</button>}</li>)}</ul>
      {(esAdmin || tasas.data) && tasas.data && <form onSubmit={guardarTasas} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-2 gap-space-sm items-end" key={`${tasas.data.iva}-${tasas.data.it}`}><h2 className="font-headline-sm text-headline-sm col-span-2">Tasas de impuestos (parámetros de la sucursal)</h2>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>IVA %</span><input name="iva" inputMode="decimal" defaultValue={tasas.data.iva} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>IT %</span><input name="it" inputMode="decimal" defaultValue={tasas.data.it} className={clases.input} /></label>
        <p className="col-span-2 font-body-sm text-on-surface-variant">Referenciales. Tu contador debe validar las tasas y las cifras antes de declarar.</p>
        {esAdmin && <button className={`${clases.primario} col-span-2`}>Guardar tasas</button>}</form>}
    </section>
  );
}
