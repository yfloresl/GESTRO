import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';

type Estado = 'cotizado' | 'confirmado' | 'en_curso' | 'cerrado' | 'cancelado';
interface Evento { id: string; nombre: string; tipo: string; cliente: string | null; telefono: string | null; invitados: number; estado: Estado; precio: string | null; notas: string | null; fecha: string; horaInicio: string; horaFin: string; pagado: string; saldo: string | null; insumosDescontados: boolean }
interface Cotizacion { platos: { platoId: string; nombre: string; porciones: number; precioCarta: string; tieneReceta: boolean; costoPorPorcion: string | null; costoTotal: string | null }[]; ventaACarta: string; costo: string; precioPactado: string | null; margenPct: string | null; utilidad: string; porInvitado: string | null; costoPersonal: string; costoTotal: string; personal: { persona: string; funcion: string | null; horas: string; costo: string }[]; sinReceta: string[]; insumos: { insumoId: string; insumo: string; unidad: string; requerido: string; stock: string; faltante: string; alcanza: boolean }[]; hayFaltantes: boolean }
interface Detalle extends Evento { cotizacion: Cotizacion; pagos: { id: string; monto: string; tipo: string; via: string; fecha: string; anulado: boolean }[] }
interface Plato { id: string; nombre: string; precio: string }

const ESTADO: Record<Estado, { t: string; c: string }> = {
  cotizado: { t: 'Cotizado', c: 'bg-secondary-fixed text-on-secondary-fixed-variant' }, confirmado: { t: 'Confirmado', c: 'bg-primary-fixed text-on-primary-fixed-variant' },
  en_curso: { t: 'En curso', c: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' }, cerrado: { t: 'Cerrado', c: 'bg-surface-container text-on-surface-variant' }, cancelado: { t: 'Cancelado', c: 'bg-error-container text-on-error-container' },
};
const TIPO: Record<string, string> = { evento: 'Evento', catering: 'Catering', buffet: 'Buffet', privado: 'Privado' };
const num = (v: FormDataEntryValue | string | null) => Number(String(v ?? '').replace(',', '.'));
const hoy = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);

/** Eventos & catering: cotización con costo de recetas, menú, anticipos, inicio, cierre y cancelación. */
export function Eventos() {
  const { sucursalId } = useRolesActivos();
  const [estado, setEstado] = useState(''); const [abierto, setAbierto] = useState<string | null>(null); const [nuevo, setNuevo] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['eventos', sucursalId, estado], queryFn: () => api.get<Evento[]>(`/eventos${estado ? `?estado=${estado}` : ''}`, sucursalId!), enabled: !!sucursalId });
  if (!sucursalId) return null;
  const refrescar = () => { void qc.invalidateQueries({ queryKey: ['eventos'] }); void qc.invalidateQueries({ queryKey: ['evento'] }); void qc.invalidateQueries({ queryKey: ['conta'] }); };
  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-end justify-between gap-space-sm"><div><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Eventos &amp; Catering</h1><p className="font-body-md text-body-md text-on-surface-variant">Cotiza con el costo real de tus recetas, cobra anticipos y cierra el evento.</p></div>
        <button type="button" onClick={() => setNuevo(true)} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">add_circle</span>Nuevo evento</button></header>
      <div className="flex flex-wrap gap-space-xs">{[['', 'Todos'], ['cotizado', 'Cotizados'], ['confirmado', 'Confirmados'], ['en_curso', 'En curso'], ['cerrado', 'Cerrados']].map(([k, n]) => <button key={k} aria-pressed={estado === k} onClick={() => setEstado(k)} className={`h-12 px-space-md rounded-full font-label-md ${estado === k ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
      {q.isLoading ? <p role="status">Cargando…</p> : (q.data ?? []).length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">No hay eventos. Crea el primero con «Nuevo evento».</p> : (
        <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">{q.data!.map((e) => (
          <li key={e.id}><button type="button" onClick={() => setAbierto(e.id)} className="w-full text-left bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-xs hover:border-primary">
            <div className="flex items-center justify-between gap-space-sm"><span className="font-headline-sm text-headline-sm truncate">{e.nombre}</span><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase whitespace-nowrap ${ESTADO[e.estado].c}`}>{ESTADO[e.estado].t}</span></div>
            <p className="font-body-sm text-on-surface-variant">{TIPO[e.tipo]} · {e.fecha} · {e.horaInicio}–{e.horaFin} · {e.invitados} invitados</p>
            <p className="font-label-lg text-primary">{e.precio ? bs(e.precio) : 'Sin precio'}{e.precio && Number(e.pagado) > 0 ? <span className="font-body-sm text-on-surface-variant"> · cobrado {bs(e.pagado)}</span> : null}</p></button></li>))}</ul>)}
      {abierto && <DetalleEvento id={abierto} cerrar={() => setAbierto(null)} hecho={refrescar} />}
      {nuevo && <FormEvento cerrar={() => setNuevo(false)} hecho={() => { setNuevo(false); refrescar(); }} />}
    </div>
  );
}

function FormEvento({ evento, cerrar, hecho }: { evento?: Evento; cerrar(): void; hecho(): void }) {
  const { sucursalId } = useRolesActivos(); const [error, setError] = useState<string | null>(null);
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim();
    const cuerpo = { nombre: s('nombre'), tipo: s('tipo'), cliente: s('cliente') || null, telefono: s('telefono') || null, invitados: num(f.get('invitados')), fecha: s('fecha'), horaInicio: s('ini'), horaFin: s('fin'), precio: s('precio') ? num(f.get('precio')) : null, notas: s('notas') || null };
    try { if (evento) await api.put(`/eventos/${evento.id}`, cuerpo, sucursalId!); else await api.post('/eventos', cuerpo, sucursalId!); hecho(); } catch (err) { setError(mensajeDeError(err)); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={evento ? 'Editar evento' : 'Nuevo evento'} className="fixed inset-0 z-[70] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <form onSubmit={enviar} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">{evento ? 'Editar evento' : 'Nuevo evento'}</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Nombre</span><input name="nombre" required minLength={2} maxLength={120} defaultValue={evento?.nombre} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Tipo</span><select name="tipo" defaultValue={evento?.tipo ?? 'evento'} className={clases.input}>{Object.entries(TIPO).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-space-sm"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Cliente</span><input name="cliente" maxLength={120} defaultValue={evento?.cliente ?? ''} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Teléfono</span><input name="telefono" inputMode="tel" defaultValue={evento?.telefono ?? ''} className={clases.input} /></label></div>
        <div className="grid grid-cols-3 gap-space-sm"><label className="flex flex-col gap-space-xs col-span-3 sm:col-span-1"><span className={clases.etiqueta}>Fecha</span><input name="fecha" type="date" required defaultValue={evento?.fecha ?? hoy()} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Desde</span><input name="ini" type="time" required defaultValue={evento?.horaInicio ?? '19:00'} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Hasta</span><input name="fin" type="time" required defaultValue={evento?.horaFin ?? '23:00'} className={clases.input} /></label></div>
        <div className="grid grid-cols-2 gap-space-sm"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Invitados</span><input name="invitados" type="number" min={1} max={5000} required defaultValue={evento?.invitados ?? 50} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Precio pactado (Bs)</span><input name="precio" inputMode="decimal" defaultValue={evento?.precio ? Number(evento.precio) : ''} className={clases.input} /></label></div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Notas</span><input name="notas" maxLength={500} defaultValue={evento?.notas ?? ''} className={clases.input} /></label>
        {error && <p role="alert" className="text-error">{error}</p>}<button className={clases.primario}>{evento ? 'Guardar cambios' : 'Crear cotización'}</button>
      </form>
    </div>
  );
}

function DetalleEvento({ id, cerrar, hecho }: { id: string; cerrar(): void; hecho(): void }) {
  const { sucursalId, esAdmin, roles } = useRolesActivos();
  const puedeCobrar = esAdmin || roles.includes('cajero'); const puedeIniciar = esAdmin || roles.includes('cocina'); const puedeCompras = esAdmin || roles.includes('almacen');
  const [error, setError] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [editando, setEditando] = useState(false); const [menu, setMenu] = useState<{ platoId: string; porciones: string }[] | null>(null);
  const q = useQuery({ queryKey: ['evento', sucursalId, id], queryFn: () => api.get<Detalle>(`/eventos/${id}`, sucursalId!), enabled: !!sucursalId });
  const platos = useQuery({ queryKey: ['platos-menu', sucursalId], queryFn: () => api.get<Plato[]>('/menu/platos', sucursalId!), enabled: !!sucursalId && menu !== null });
  const e = q.data; const c = e?.cotizacion;
  const accion = async (f: () => Promise<unknown>, ok?: string) => { setError(null); setMsg(null); try { await f(); if (ok) setMsg(ok); hecho(); } catch (err) { setError(mensajeDeError(err)); } };
  const cobrar = (ev: FormEvent<HTMLFormElement>) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); const form = ev.currentTarget; void accion(async () => { await api.post(`/eventos/${id}/cobros`, { monto: num(f.get('monto')), via: String(f.get('via')) }, sucursalId!); form.reset(); }, 'Cobro registrado.'); };
  const guardarMenu = () => accion(async () => { await api.put(`/eventos/${id}/menu`, { platos: (menu ?? []).filter((m) => m.platoId && num(m.porciones) > 0).map((m) => ({ platoId: m.platoId, porciones: Math.round(num(m.porciones)) })) }, sucursalId!); setMenu(null); }, 'Menú guardado.');
  const cancelar = () => {
    const motivo = prompt('Motivo de la cancelación'); if (!motivo) return;
    const devolver = Number(e?.pagado) > 0 ? confirm(`Hay ${bs(e!.pagado)} cobrados. ¿Se devuelven al cliente?`) : false;
    if (Number(e?.pagado) > 0 && !devolver) return;
    void accion(() => api.post(`/eventos/${id}/cancelar`, { motivo, devolver }, sucursalId!), 'Evento cancelado.');
  };
  const vivo = e && ['cotizado', 'confirmado'].includes(e.estado);
  return (
    <div role="dialog" aria-modal="true" aria-label="Evento" className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <div onClick={(ev) => ev.stopPropagation()} className="w-full max-w-2xl bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">{e?.nombre ?? 'Evento'}</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        {!e || !c ? <p role="status">Cargando…</p> : <>
          <p className="flex flex-wrap items-center gap-space-sm"><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase ${ESTADO[e.estado].c}`}>{ESTADO[e.estado].t}</span><span className="text-on-surface-variant">{TIPO[e.tipo]} · {e.fecha} · {e.horaInicio}–{e.horaFin} · {e.invitados} invitados</span></p>
          {(e.cliente || e.telefono) && <p>{e.cliente} {e.telefono && `· ${e.telefono}`}</p>}{e.notas && <p className="italic text-on-surface-variant whitespace-pre-line">{e.notas}</p>}
          {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}{msg && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}

          <section className="grid grid-cols-2 gap-gutter md:grid-cols-5">
            {[['Precio pactado', c.precioPactado ? bs(c.precioPactado) : '—'], ['Costo de recetas', bs(c.costo)], ['Personal', bs(c.costoPersonal)], ['Utilidad', `${bs(c.utilidad)}${c.margenPct ? ` · ${c.margenPct}%` : ''}`], ['Por invitado', c.porInvitado ? bs(c.porInvitado) : '—']].map(([t, v]) => <div key={t} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-sm"><p className="font-label-sm uppercase text-on-surface-variant">{t}</p><p className="font-label-lg text-primary">{v}</p></div>)}
          </section>

          <section className="flex flex-col gap-space-xs"><div className="flex items-center justify-between"><h3 className="font-headline-sm text-headline-sm">Menú</h3>{vivo && esAdmin && menu === null && <button type="button" onClick={() => setMenu(c.platos.map((p) => ({ platoId: p.platoId, porciones: String(p.porciones) })).concat(c.platos.length ? [] : [{ platoId: '', porciones: '' }]))} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold">Editar menú</button>}</div>
            {menu === null ? (c.platos.length === 0 ? <p className="text-on-surface-variant">Sin platos todavía.</p> : <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="w-full text-body-sm"><caption className="sr-only">Menú del evento</caption><thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Plato</th><th className="p-3 text-right">Porciones</th><th className="p-3 text-right">Costo c/u</th><th className="p-3 text-right">Carta</th></tr></thead>
              <tbody>{c.platos.map((p) => <tr key={p.platoId} className="border-t border-outline-variant"><td className="p-3 font-semibold">{p.nombre}{!p.tieneReceta && <span className="ml-1 text-secondary font-normal">(sin receta)</span>}</td><td className="p-3 text-right">{p.porciones}</td><td className="p-3 text-right">{p.costoPorPorcion ? bs(p.costoPorPorcion) : '—'}</td><td className="p-3 text-right">{bs(p.precioCarta)}</td></tr>)}</tbody></table></div>) : (
              <div className="flex flex-col gap-space-xs">{menu.map((m, i) => <div key={i} className="grid grid-cols-[1fr_6rem_2.5rem] gap-space-xs items-center">
                <select aria-label="Plato" value={m.platoId} onChange={(ev) => setMenu(menu.map((x, k) => (k === i ? { ...x, platoId: ev.target.value } : x)))} className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm min-w-0"><option value="">Elige…</option>{(platos.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre} ({bs(p.precio)})</option>)}</select>
                <input aria-label="Porciones" placeholder="Porciones" inputMode="numeric" value={m.porciones} onChange={(ev) => setMenu(menu.map((x, k) => (k === i ? { ...x, porciones: ev.target.value } : x)))} className="h-12 rounded-lg border border-outline-variant px-space-sm" />
                <button type="button" aria-label="Quitar plato" onClick={() => setMenu(menu.filter((_, k) => k !== i))} className="w-10 h-12 text-error"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>)}
                <button type="button" onClick={() => setMenu([...menu, { platoId: '', porciones: String(e.invitados) }])} className="h-12 rounded-lg border border-dashed border-outline text-primary font-semibold">+ Agregar plato</button>
                <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={() => setMenu(null)} className="h-12 rounded-lg border border-outline-variant font-semibold">Cancelar</button><button type="button" onClick={guardarMenu} className={clases.primario}>Guardar menú</button></div></div>)}
          </section>

          {c.insumos.length > 0 && <section className="flex flex-col gap-space-xs"><h3 className="font-headline-sm text-headline-sm">Insumos necesarios</h3>
            <ul className="flex flex-col gap-1">{c.insumos.map((i) => <li key={i.insumoId} className={`flex justify-between rounded-lg p-space-sm ${i.alcanza ? 'bg-surface-container' : 'bg-secondary-fixed text-on-secondary-fixed-variant'}`}><span>{i.insumo}</span><span className="font-label-md">{Number(i.requerido)} {i.unidad}{!i.alcanza && ` · faltan ${Number(i.faltante)}`}</span></li>)}</ul>
            {c.hayFaltantes && puedeCompras && <button type="button" onClick={() => accion(async () => { const r = await api.post<{ ordenes: unknown[] }>(`/eventos/${id}/ordenes-de-compra`, undefined, sucursalId!); setMsg(`Se crearon ${r.ordenes.length} orden(es) de compra en borrador.`); })} className="h-12 px-space-md rounded-lg border border-primary text-primary font-semibold self-start">Crear órdenes de compra con lo que falta</button>}
            {c.sinReceta.length > 0 && <p className="font-body-sm text-on-surface-variant">Sin receta (no descuentan stock): {c.sinReceta.join(', ')}.</p>}</section>}

          <section className="flex flex-col gap-space-xs"><h3 className="font-headline-sm text-headline-sm">Cobros</h3>
            <p>Cobrado <strong>{bs(e.pagado)}</strong>{e.saldo !== null && <> · saldo <strong>{bs(e.saldo)}</strong></>}</p>
            {e.pagos.length > 0 && <ul className="flex flex-col gap-1">{e.pagos.map((p) => <li key={p.id} className={`flex justify-between rounded-lg bg-surface-container p-space-sm ${p.anulado ? 'line-through opacity-60' : ''}`}><span>{new Date(p.fecha).toLocaleDateString('es-BO')} · {p.tipo} · {p.via === 'caja' ? 'efectivo' : 'banco'}</span><span className="font-label-md">{bs(p.monto)}</span></li>)}</ul>}
            {puedeCobrar && ['cotizado', 'confirmado', 'en_curso'].includes(e.estado) && e.precio && Number(e.saldo) > 0 && (
              <form onSubmit={cobrar} className="grid grid-cols-[1fr_auto_auto] gap-space-xs items-end"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Monto (Bs)</span><input name="monto" required inputMode="decimal" className={clases.input} /></label>
                <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Cómo</span><select name="via" className="h-[52px] rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm"><option value="caja">Efectivo</option><option value="bancos">Banco / QR</option></select></label>
                <button className="h-[52px] px-space-md rounded-lg bg-primary text-on-primary font-semibold">Cobrar</button></form>)}</section>

          <section className="grid grid-cols-2 gap-space-sm">
            {vivo && esAdmin && <button type="button" onClick={() => setEditando(true)} className="h-14 rounded-lg border border-outline-variant font-semibold">Editar datos</button>}
            {e.estado === 'cotizado' && esAdmin && <button type="button" onClick={() => accion(() => api.post(`/eventos/${id}/estado`, { accion: 'confirmar' }, sucursalId!), 'Evento confirmado.')} className={clases.primario}>Confirmar</button>}
            {e.estado === 'confirmado' && puedeIniciar && <button type="button" onClick={() => { if (confirm('Al iniciar se descuentan del inventario los insumos del menú. ¿Iniciar el evento?')) void accion(() => api.post(`/eventos/${id}/estado`, { accion: 'iniciar' }, sucursalId!), 'Evento iniciado: insumos descontados.'); }} className={clases.primario}>Iniciar evento</button>}
            {e.estado === 'en_curso' && esAdmin && <button type="button" onClick={() => { if (confirm(`Cerrar el evento. ${Number(e.saldo) > 0 ? `Quedarán ${bs(e.saldo ?? 0)} por cobrar al cliente.` : 'Está cobrado por completo.'}`)) void accion(() => api.post(`/eventos/${id}/cerrar`, {}, sucursalId!), 'Evento cerrado.'); }} className={`${clases.primario} col-span-2`}>Cerrar evento</button>}
            {vivo && esAdmin && <button type="button" onClick={cancelar} className="h-14 rounded-lg border border-error text-error font-semibold col-span-2">Cancelar evento</button>}
          </section>
          {editando && <FormEvento evento={e} cerrar={() => setEditando(false)} hecho={() => { setEditando(false); hecho(); }} />}
        </>}
      </div>
    </div>
  );
}
