import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';

interface Promo { id: string; nombre: string; alcance: string; descuentoPct: string | null; precioFijo: string | null; desde: string; hasta: string; diasSemana: number[] | null; horaDesde: string | null; horaHasta: string | null; platos: string[]; platosNombres: string[]; activa: boolean; estado: 'vigente' | 'programada' | 'vencida' | 'inactiva' | 'fuera_de_horario'; vigenteAhora: boolean }
interface Uso { promociones: { id: string; nombre: string; unidades: string; vendido: string; descuento: string }[]; totalDescuento: string }
interface Plato { id: string; nombre: string; precio: string }

const ESTADO: Record<Promo['estado'], { t: string; c: string }> = {
  vigente: { t: 'Vigente ahora', c: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' }, programada: { t: 'Programada', c: 'bg-primary-fixed text-on-primary-fixed-variant' },
  vencida: { t: 'Vencida', c: 'bg-surface-container text-on-surface-variant' }, inactiva: { t: 'Desactivada', c: 'bg-surface-container text-on-surface-variant' }, fuera_de_horario: { t: 'Fuera de horario', c: 'bg-secondary-fixed text-on-secondary-fixed-variant' },
};
const DIAS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']] as const;
const hoy = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
const sumar = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(',', '.'));

/** Promociones (pantalla 5.9): descuentos o precios fijos por fechas, días y horario, y su efecto en las ventas. */
export function Promociones() {
  const { sucursalId, esAdmin } = useRolesActivos();
  const qc = useQueryClient(); const [editando, setEditando] = useState<Promo | 'nueva' | null>(null); const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['promociones', sucursalId], queryFn: () => api.get<Promo[]>('/promociones', sucursalId!), enabled: !!sucursalId });
  const uso = useQuery({ queryKey: ['promociones-uso', sucursalId], queryFn: () => api.get<Uso>('/promociones/uso', sucursalId!), enabled: !!sucursalId && esAdmin });
  if (!sucursalId) return null;
  const refrescar = () => { void qc.invalidateQueries({ queryKey: ['promociones'] }); void qc.invalidateQueries({ queryKey: ['promociones-uso'] }); void qc.invalidateQueries({ queryKey: ['platos-menu'] }); };
  const accion = async (f: () => Promise<unknown>) => { setError(null); try { await f(); refrescar(); } catch (e) { setError(mensajeDeError(e)); } };
  const regla = (p: Promo) => (p.descuentoPct ? `${Number(p.descuentoPct)}% de descuento` : `Precio fijo ${bs(p.precioFijo ?? 0)}`);
  const cuando = (p: Promo) => `${p.desde} → ${p.hasta}${p.diasSemana ? ` · ${p.diasSemana.map((d) => DIAS[d - 1][1]).join(', ')}` : ''}${p.horaDesde ? ` · ${p.horaDesde}–${p.horaHasta}` : ''}`;
  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-end justify-between gap-space-sm"><div><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Promociones</h1><p className="font-body-md text-body-md text-on-surface-variant">El precio con promoción lo aplica el sistema al tomar el pedido; si hay varias, gana la más baja.</p></div>
        {esAdmin && <button type="button" onClick={() => setEditando('nueva')} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">add_circle</span>Nueva promoción</button>}</header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {q.isLoading ? <p role="status">Cargando…</p> : (q.data ?? []).length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Todavía no hay promociones.</p> : (
        <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">{q.data!.map((p) => (
          <li key={p.id} className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-xs ${p.estado === 'vencida' || p.estado === 'inactiva' ? 'opacity-70' : ''}`}>
            <div className="flex items-center justify-between gap-space-sm"><span className="font-headline-sm text-headline-sm truncate">{p.nombre}</span><span className={`px-2 py-0.5 rounded-full font-label-sm uppercase whitespace-nowrap ${ESTADO[p.estado].c}`}>{ESTADO[p.estado].t}</span></div>
            <p className="font-label-lg text-primary">{regla(p)}</p>
            <p className="font-body-sm text-on-surface-variant">{cuando(p)}</p>
            <p className="font-body-sm">{p.platosNombres.length ? p.platosNombres.join(', ') : 'Todos los platos'}</p>
            {esAdmin && <div className="flex flex-wrap gap-space-xs pt-space-xs">
              <button type="button" onClick={() => setEditando(p)} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold">Editar</button>
              <button type="button" onClick={() => accion(() => api.post(`/promociones/${p.id}/activa`, { activa: !p.activa }, sucursalId))} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold">{p.activa ? 'Desactivar' : 'Activar'}</button>
              <button type="button" onClick={() => { if (confirm(`¿Borrar «${p.nombre}»? Si ya tiene ventas, se te pedirá desactivarla.`)) void accion(() => api.del(`/promociones/${p.id}`, undefined, sucursalId)); }} className="h-12 px-space-md rounded-lg border border-error text-error font-semibold">Borrar</button></div>}
          </li>))}</ul>)}
      {esAdmin && uso.data && uso.data.promociones.length > 0 && (
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="w-full text-body-sm"><caption className="text-left p-3 font-headline-sm text-headline-sm">Efecto en las ventas (últimos 30 días)</caption>
          <thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Promoción</th><th className="p-3 text-right">Platos</th><th className="p-3 text-right">Vendido</th><th className="p-3 text-right">Descuento dado</th></tr></thead>
          <tbody>{uso.data.promociones.map((u) => <tr key={u.id} className="border-t border-outline-variant"><td className="p-3 font-semibold">{u.nombre}</td><td className="p-3 text-right">{Number(u.unidades)}</td><td className="p-3 text-right">{bs(u.vendido)}</td><td className="p-3 text-right">{bs(u.descuento)}</td></tr>)}
            <tr className="border-t border-outline-variant font-semibold"><td className="p-3" colSpan={3}>Total descontado</td><td className="p-3 text-right">{bs(uso.data.totalDescuento)}</td></tr></tbody></table></div>)}
      {editando && <FormPromo promo={editando === 'nueva' ? undefined : editando} cerrar={() => setEditando(null)} hecho={() => { setEditando(null); refrescar(); }} />}
    </div>
  );
}

function FormPromo({ promo, cerrar, hecho }: { promo?: Promo; cerrar(): void; hecho(): void }) {
  const { sucursalId } = useRolesActivos();
  const platos = useQuery({ queryKey: ['platos-menu', sucursalId], queryFn: () => api.get<Plato[]>('/menu/platos', sucursalId!), enabled: !!sucursalId });
  const [tipo, setTipo] = useState<'pct' | 'fijo'>(promo?.precioFijo ? 'fijo' : 'pct'); const [dias, setDias] = useState<number[]>(promo?.diasSemana ?? []); const [elegidos, setElegidos] = useState<string[]>(promo?.platos ?? []);
  const [horario, setHorario] = useState(!!promo?.horaDesde); const [error, setError] = useState<string | null>(null);
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim();
    const cuerpo = { nombre: s('nombre'), descuentoPct: tipo === 'pct' ? num(f.get('valor')) : null, precioFijo: tipo === 'fijo' ? num(f.get('valor')) : null, desde: s('desde'), hasta: s('hasta'), diasSemana: dias.length ? dias : null, horaDesde: horario ? s('hd') : null, horaHasta: horario ? s('hh') : null, platos: elegidos };
    try { if (promo) await api.put(`/promociones/${promo.id}`, cuerpo, sucursalId!); else await api.post('/promociones', cuerpo, sucursalId!); hecho(); } catch (err) { setError(mensajeDeError(err)); }
  };
  const alternar = <T,>(lista: T[], v: T) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  return (
    <div role="dialog" aria-modal="true" aria-label={promo ? 'Editar promoción' : 'Nueva promoción'} className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <form onSubmit={enviar} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">{promo ? 'Editar promoción' : 'Nueva promoción'}</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Nombre</span><input name="nombre" required minLength={2} maxLength={80} defaultValue={promo?.nombre} className={clases.input} /></label>
        <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Qué ofrece</legend>
          <div className="grid grid-cols-2 gap-space-xs">{([['pct', 'Descuento %'], ['fijo', 'Precio fijo']] as const).map(([k, n]) => <button key={k} type="button" role="radio" aria-checked={tipo === k} onClick={() => setTipo(k)} className={`h-12 rounded-lg font-semibold ${tipo === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>
          <input name="valor" required inputMode="decimal" aria-label={tipo === 'pct' ? 'Porcentaje de descuento' : 'Precio fijo en Bs'} placeholder={tipo === 'pct' ? 'Ej. 20' : 'Ej. 30 (Bs)'} defaultValue={promo ? Number(promo.descuentoPct ?? promo.precioFijo) : ''} className={clases.input} /></fieldset>
        <div className="grid grid-cols-2 gap-space-sm"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Desde</span><input name="desde" type="date" required defaultValue={promo?.desde ?? hoy()} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Hasta (inclusive)</span><input name="hasta" type="date" required defaultValue={promo?.hasta ?? sumar(hoy(), 7)} className={clases.input} /></label></div>
        <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Días (ninguno = todos)</legend><div className="flex flex-wrap gap-space-xs">{DIAS.map(([n, t]) => <button key={n} type="button" aria-pressed={dias.includes(n)} onClick={() => setDias(alternar(dias, n))} className={`h-12 px-space-md rounded-full font-label-md ${dias.includes(n) ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'}`}>{t}</button>)}</div></fieldset>
        <label className="flex items-center gap-space-sm min-h-12"><input type="checkbox" className="w-6 h-6" checked={horario} onChange={(e) => setHorario(e.target.checked)} /><span>Solo en un horario (happy hour)</span></label>
        {horario && <div className="grid grid-cols-2 gap-space-sm"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>De</span><input name="hd" type="time" required defaultValue={promo?.horaDesde ?? '17:00'} className={clases.input} /></label><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>A</span><input name="hh" type="time" required defaultValue={promo?.horaHasta ?? '19:00'} className={clases.input} /></label></div>}
        <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Platos {tipo === 'fijo' ? '(obligatorio)' : '(ninguno = todos)'}</legend>
          <ul className="flex flex-col gap-1 max-h-56 overflow-y-auto">{(platos.data ?? []).map((p) => <li key={p.id}><label className="flex items-center gap-space-sm min-h-12 rounded-lg bg-surface-container px-space-sm"><input type="checkbox" className="w-6 h-6" checked={elegidos.includes(p.id)} onChange={() => setElegidos(alternar(elegidos, p.id))} /><span className="flex-1">{p.nombre}</span><span className="text-on-surface-variant">{bs(p.precio)}</span></label></li>)}</ul></fieldset>
        {error && <p role="alert" className="text-error">{error}</p>}<button className={clases.primario}>{promo ? 'Guardar cambios' : 'Crear promoción'}</button>
      </form>
    </div>
  );
}
