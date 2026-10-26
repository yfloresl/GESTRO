import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';

interface Turno { id: string; personaId: string; persona: string; funcion: string | null; eventoId: string | null; evento: string | null; notas: string | null; fecha: string; horaInicio: string; horaFin: string; cruzaDia: boolean; entrada: string | null; salida: string | null; horas: string; pago?: string | null; costoPlanificado?: string }
interface Persona { id: string; nombre: string; telefono: string | null; documento: string | null; tipo: string; activo: boolean; funcionId: string | null; funcion: string | null; tieneUsuario: boolean; costoHora?: string | null; sueldoMensual?: string | null }
interface Funcion { id: string; nombre: string; descripcion: string | null; personas: number }
interface Costo { personas: { personaId: string; persona: string; turnos: number; horasProgramadas: string; horasTrabajadas: string; pagoPorHoras: string; costoPlanificado: string }[]; porEvento: { eventoId: string; evento: string; horas: string; costoPlanificado: string }[]; totalPagoPorHoras: string; totalPlanificado: string }
type Pestana = 'mis' | 'semana' | 'personas' | 'costo';

const hoy = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
const sumar = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const lunes = (f: string) => { const d = new Date(`${f}T12:00:00Z`).getUTCDay(); return sumar(f, -((d + 6) % 7)); };
const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const nomDia = (f: string) => `${DIA[new Date(`${f}T12:00:00Z`).getUTCDay()]} ${f.slice(8)}/${f.slice(5, 7)}`;
const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(',', '.'));

/** Turnos & asistencia: «Mis turnos» para todos; programación, personas y costo para quien administra. */
export function Turnos() {
  const { sucursalId, esAdmin, roles } = useRolesActivos();
  const programa = esAdmin || roles.includes('area_manager'); const veCosto = esAdmin || roles.includes('contador');
  const pestanas: [Pestana, string][] = [['mis', 'Mis turnos'], ...(programa || roles.includes('contador') ? ([['semana', 'Semana']] as [Pestana, string][]) : []), ...(esAdmin || roles.includes('contador') ? ([['personas', 'Personas y funciones']] as [Pestana, string][]) : []), ...(veCosto ? ([['costo', 'Costo de personal']] as [Pestana, string][]) : [])];
  const [p, setP] = useState<Pestana>('mis');
  if (!sucursalId) return null;
  return (
    <div className="flex flex-col gap-space-lg">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Turnos &amp; Asistencia</h1><p className="font-body-md text-body-md text-on-surface-variant">Marca tu entrada y salida; quien administra programa la semana y ve el costo.</p></header>
      {pestanas.length > 1 && <div className="flex gap-space-xs overflow-x-auto" role="tablist" aria-label="Secciones">{pestanas.map(([k, n]) => <button key={k} role="tab" aria-selected={p === k} onClick={() => setP(k)} className={`h-12 px-space-md rounded-lg font-semibold whitespace-nowrap ${p === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}</div>}
      {p === 'mis' && <Mis />}{p === 'semana' && <Semana programa={programa} />}{p === 'personas' && <Personas edita={esAdmin} verPago={veCosto} />}{p === 'costo' && <CostoVista />}
    </div>
  );
}

function Mis() {
  const { sucursalId } = useRolesActivos(); const qc = useQueryClient(); const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['turnos-mis', sucursalId], queryFn: () => api.get<Turno[]>('/turnos/mis', sucursalId!), enabled: !!sucursalId });
  const marcar = async (t: Turno, que: 'entrada' | 'salida') => { setError(null); try { await api.post(`/turnos/${t.id}/${que}`, undefined, sucursalId!); await qc.invalidateQueries({ queryKey: ['turnos-mis'] }); } catch (e) { setError(mensajeDeError(e)); } };
  const lista = q.data ?? [];
  return (
    <section className="flex flex-col gap-space-sm">{error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {q.isLoading ? <p role="status">Cargando…</p> : lista.length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">No tienes turnos programados en los próximos días.</p> : (
        <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2">{lista.map((t) => (
          <li key={t.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-xs">
            <p className="font-headline-sm text-headline-sm">{nomDia(t.fecha)} · {t.horaInicio}–{t.horaFin}{t.cruzaDia && <span className="font-body-sm text-on-surface-variant"> (+1 día)</span>}</p>
            <p className="text-on-surface-variant">{t.funcion ?? 'Sin función'}{t.evento ? ` · Evento: ${t.evento}` : ''} · {Number(t.horas)} h</p>
            <p className="font-body-sm">{t.entrada ? `Entrada ${t.entrada}` : 'Sin entrada'}{t.salida ? ` · Salida ${t.salida}` : ''}</p>
            {!t.entrada && <button type="button" onClick={() => marcar(t, 'entrada')} className={clases.primario}>Marcar entrada</button>}
            {t.entrada && !t.salida && <button type="button" onClick={() => marcar(t, 'salida')} className="h-14 rounded-lg bg-primary-container text-on-primary font-semibold">Marcar salida</button>}
          </li>))}</ul>)}
    </section>
  );
}

function Semana({ programa }: { programa: boolean }) {
  const { sucursalId } = useRolesActivos(); const qc = useQueryClient();
  const [ini, setIni] = useState(lunes(hoy())); const [nuevo, setNuevo] = useState<{ fecha: string; personaId?: string } | null>(null); const [abierto, setAbierto] = useState<Turno | null>(null);
  const fin = sumar(ini, 6); const dias = Array.from({ length: 7 }, (_, i) => sumar(ini, i));
  const q = useQuery({ queryKey: ['turnos', sucursalId, ini], queryFn: () => api.get<Turno[]>(`/turnos?desde=${ini}&hasta=${fin}`, sucursalId!), enabled: !!sucursalId });
  const refrescar = () => { void qc.invalidateQueries({ queryKey: ['turnos'] }); void qc.invalidateQueries({ queryKey: ['evento'] }); };
  const lista = q.data ?? [];
  return (
    <section className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-center gap-space-xs">
        <button type="button" aria-label="Semana anterior" onClick={() => setIni(sumar(ini, -7))} className="w-12 h-12 rounded-lg bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">chevron_left</span></button>
        <span className="font-label-lg px-space-sm">{nomDia(ini)} – {nomDia(fin)}</span>
        <button type="button" aria-label="Semana siguiente" onClick={() => setIni(sumar(ini, 7))} className="w-12 h-12 rounded-lg bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>
        <button type="button" onClick={() => setIni(lunes(hoy()))} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold">Esta semana</button>
        {programa && <button type="button" onClick={() => setNuevo({ fecha: hoy() >= ini && hoy() <= fin ? hoy() : ini })} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold ml-auto">Nuevo turno</button>}</div>
      {q.isLoading ? <p role="status">Cargando…</p> : (
        <div className="grid grid-cols-1 gap-gutter md:grid-cols-7">{dias.map((d) => (
          <div key={d} className={`rounded-xl border p-space-sm flex flex-col gap-space-xs ${d === hoy() ? 'border-primary bg-primary-fixed/30' : 'border-outline-variant bg-surface-container-lowest'}`}>
            <div className="flex items-center justify-between"><h3 className="font-label-lg capitalize">{nomDia(d)}</h3>{programa && <button type="button" aria-label={`Agregar turno el ${d}`} onClick={() => setNuevo({ fecha: d })} className="w-10 h-10 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">add</span></button>}</div>
            {lista.filter((t) => t.fecha === d).map((t) => <button key={t.id} type="button" onClick={() => setAbierto(t)} className={`text-left rounded-lg p-space-xs border ${t.salida ? 'bg-surface-container border-outline-variant' : t.entrada ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant border-transparent' : 'bg-secondary-fixed/50 border-transparent'}`}>
              <span className="block font-semibold truncate">{t.persona}</span><span className="block font-body-sm">{t.horaInicio}–{t.horaFin}{t.cruzaDia ? '+1' : ''}{t.funcion ? ` · ${t.funcion}` : ''}</span>{t.evento && <span className="block font-body-sm italic truncate">{t.evento}</span>}</button>)}
          </div>))}</div>)}
      {nuevo && <FormTurno inicial={nuevo} cerrar={() => setNuevo(null)} hecho={() => { setNuevo(null); refrescar(); }} />}
      {abierto && <DetalleTurno t={abierto} programa={programa} cerrar={() => setAbierto(null)} hecho={() => { setAbierto(null); refrescar(); }} />}
    </section>
  );
}

function FormTurno({ inicial, turno, cerrar, hecho }: { inicial: { fecha: string; personaId?: string }; turno?: Turno; cerrar(): void; hecho(): void }) {
  const { sucursalId } = useRolesActivos(); const [error, setError] = useState<string | null>(null);
  const personas = useQuery({ queryKey: ['turnos-personas', sucursalId], queryFn: () => api.get<Persona[]>('/turnos/personas', sucursalId!), enabled: !!sucursalId });
  const funciones = useQuery({ queryKey: ['funciones', sucursalId], queryFn: () => api.get<Funcion[]>('/funciones', sucursalId!), enabled: !!sucursalId });
  const eventos = useQuery({ queryKey: ['eventos-activos', sucursalId], queryFn: () => api.get<{ id: string; nombre: string; fecha: string; estado: string }[]>('/eventos', sucursalId!).catch(() => []), enabled: !!sucursalId });
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); const s = (k: string) => String(f.get(k) ?? '');
    const cuerpo = { personaId: s('persona'), funcionId: s('funcion') || null, eventoId: s('evento') || null, fecha: s('fecha'), horaInicio: s('ini'), horaFin: s('fin'), notas: s('notas').trim() || null };
    try { if (turno) await api.put(`/turnos/${turno.id}`, cuerpo, sucursalId!); else await api.post('/turnos', cuerpo, sucursalId!); hecho(); } catch (err) { setError(mensajeDeError(err)); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Turno" className="fixed inset-0 z-[70] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <form onSubmit={enviar} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">{turno ? 'Editar turno' : 'Nuevo turno'}</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Persona</span><select name="persona" required defaultValue={turno?.personaId ?? inicial.personaId ?? ''} className={clases.input}><option value="">Elige…</option>{(personas.data ?? []).filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.tipo === 'temporal' ? ' (eventual)' : ''}</option>)}</select></label>
        <div className="grid grid-cols-3 gap-space-sm"><label className="flex flex-col gap-space-xs col-span-3 sm:col-span-1"><span className={clases.etiqueta}>Fecha</span><input name="fecha" type="date" required defaultValue={turno?.fecha ?? inicial.fecha} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Entra</span><input name="ini" type="time" required defaultValue={turno?.horaInicio ?? '09:00'} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Sale</span><input name="fin" type="time" required defaultValue={turno?.horaFin ?? '17:00'} className={clases.input} /></label></div>
        <p className="font-body-sm text-on-surface-variant">Si sale antes de la hora de entrada, el turno cruza la medianoche.</p>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Función (opcional)</span><select name="funcion" defaultValue="" className={clases.input}><option value="">La de la persona</option>{(funciones.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Evento (opcional)</span><select name="evento" defaultValue={turno?.eventoId ?? ''} className={clases.input}><option value="">Ninguno</option>{(eventos.data ?? []).filter((e) => !['cerrado', 'cancelado'].includes(e.estado)).map((e) => <option key={e.id} value={e.id}>{e.nombre} ({e.fecha})</option>)}</select></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Notas</span><input name="notas" maxLength={200} defaultValue={turno?.notas ?? ''} className={clases.input} /></label>
        {error && <p role="alert" className="text-error">{error}</p>}<button className={clases.primario}>{turno ? 'Guardar cambios' : 'Crear turno'}</button>
      </form>
    </div>
  );
}

function DetalleTurno({ t, programa, cerrar, hecho }: { t: Turno; programa: boolean; cerrar(): void; hecho(): void }) {
  const { sucursalId } = useRolesActivos(); const [error, setError] = useState<string | null>(null); const [editando, setEditando] = useState(false);
  const accion = async (f: () => Promise<unknown>) => { setError(null); try { await f(); hecho(); } catch (e) { setError(mensajeDeError(e)); } };
  if (editando) return <FormTurno inicial={{ fecha: t.fecha }} turno={t} cerrar={() => setEditando(false)} hecho={hecho} />;
  return (
    <div role="dialog" aria-modal="true" aria-label="Detalle del turno" className="fixed inset-0 z-[70] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">{t.persona}</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <p>{nomDia(t.fecha)} · {t.horaInicio}–{t.horaFin}{t.cruzaDia ? ' (+1 día)' : ''} · {Number(t.horas)} h</p>
        <p className="text-on-surface-variant">{t.funcion ?? 'Sin función'}{t.evento ? ` · Evento: ${t.evento}` : ''}</p>{t.notas && <p className="italic">{t.notas}</p>}
        <p>{t.entrada ? `Entrada ${t.entrada}` : 'Sin entrada'}{t.salida ? ` · Salida ${t.salida}` : ''}{t.pago ? ` · Pago ${bs(t.pago)}` : ''}</p>
        {error && <p role="alert" className="text-error">{error}</p>}
        {programa && <div className="flex flex-col gap-space-xs">
          {!t.entrada && <button type="button" onClick={() => accion(() => api.post(`/turnos/${t.id}/entrada`, undefined, sucursalId!))} className={clases.primario}>Registrar entrada</button>}
          {t.entrada && !t.salida && <button type="button" onClick={() => accion(() => api.post(`/turnos/${t.id}/salida`, undefined, sucursalId!))} className={clases.primario}>Registrar salida</button>}
          {!t.entrada && <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={() => setEditando(true)} className="h-14 rounded-lg border border-outline-variant font-semibold">Editar</button>
            <button type="button" onClick={() => { if (confirm('¿Borrar este turno?')) void accion(() => api.del(`/turnos/${t.id}`, undefined, sucursalId!)); }} className="h-14 rounded-lg border border-error text-error font-semibold">Borrar</button></div>}</div>}
      </div>
    </div>
  );
}

function Personas({ edita, verPago }: { edita: boolean; verPago: boolean }) {
  const { sucursalId } = useRolesActivos(); const qc = useQueryClient(); const [error, setError] = useState<string | null>(null);
  const personas = useQuery({ queryKey: ['turnos-personas', sucursalId], queryFn: () => api.get<Persona[]>('/turnos/personas', sucursalId!), enabled: !!sucursalId });
  const funciones = useQuery({ queryKey: ['funciones', sucursalId], queryFn: () => api.get<Funcion[]>('/funciones', sucursalId!), enabled: !!sucursalId });
  const refrescar = () => { void qc.invalidateQueries({ queryKey: ['turnos-personas'] }); void qc.invalidateQueries({ queryKey: ['funciones'] }); };
  const accion = async (f: () => Promise<unknown>) => { setError(null); try { await f(); refrescar(); } catch (e) { setError(mensajeDeError(e)); } };
  const laborales = (p: Persona, e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); void accion(() => api.patch(`/turnos/personas/${p.id}`, { funcionId: String(f.get('funcion')) || null, costoHora: String(f.get('costo')).trim() ? num(f.get('costo')) : null, sueldoMensual: String(f.get('sueldo')).trim() ? num(f.get('sueldo')) : null }, sucursalId!)); };
  const nuevaFuncion = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; void accion(async () => { await api.post('/funciones', { nombre: String(f.get('nombre')).trim() }, sucursalId!); form.reset(); }); };
  const eventual = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; const s = (k: string) => String(f.get(k) ?? '').trim(); void accion(async () => { await api.post('/turnos/personas', { nombre: s('nombre'), telefono: s('telefono') || null, funcionId: s('funcion') || null, costoHora: s('costo') ? num(f.get('costo')) : null }, sucursalId!); form.reset(); }); };
  return (
    <section className="flex flex-col gap-space-md">{error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm"><h2 className="font-headline-sm text-headline-sm">Funciones</h2>
        <ul className="flex flex-wrap gap-space-xs">{(funciones.data ?? []).map((f) => <li key={f.id} className="rounded-full bg-surface-container px-space-md py-1 flex items-center gap-space-xs">{f.nombre} <span className="text-on-surface-variant font-body-sm">({f.personas})</span>{edita && <button type="button" aria-label={`Borrar ${f.nombre}`} onClick={() => accion(() => api.del(`/funciones/${f.id}`, undefined, sucursalId!))} className="text-error"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span></button>}</li>)}</ul>
        {edita && <form onSubmit={nuevaFuncion} className="flex gap-space-xs"><input name="nombre" required minLength={2} maxLength={60} placeholder="Nueva función (p. ej. Barista)" aria-label="Nombre de la función" className={clases.input} /><button className="h-[52px] px-space-md rounded-lg bg-primary text-on-primary font-semibold">Agregar</button></form>}</div>
      {edita && <form onSubmit={eventual} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-2 gap-space-sm md:grid-cols-5 items-end"><h2 className="font-headline-sm text-headline-sm col-span-2 md:col-span-5">Persona eventual (para eventos y reemplazos)</h2>
        <label className="flex flex-col gap-space-xs col-span-2"><span className={clases.etiqueta}>Nombre</span><input name="nombre" required minLength={2} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Teléfono</span><input name="telefono" inputMode="tel" className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Función</span><select name="funcion" className={clases.input}><option value="">—</option>{(funciones.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Bs por hora</span><input name="costo" inputMode="decimal" className={clases.input} /></label>
        <button className={`${clases.primario} col-span-2 md:col-span-5`}>Agregar eventual</button></form>}
      <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2">{(personas.data ?? []).map((p) => (
        <li key={p.id} className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-xs ${p.activo ? '' : 'opacity-60'}`}>
          <p className="font-semibold">{p.nombre} {p.tipo === 'temporal' && <span className="font-body-sm font-normal text-on-surface-variant">· eventual</span>}</p>
          <p className="font-body-sm text-on-surface-variant">{p.funcion ?? 'Sin función'}{p.telefono ? ` · ${p.telefono}` : ''}{verPago && p.costoHora ? ` · ${bs(p.costoHora)}/h` : ''}{verPago && p.sueldoMensual ? ` · sueldo ${bs(p.sueldoMensual)}` : ''}</p>
          {edita && <form onSubmit={(e) => laborales(p, e)} key={`${p.funcionId}${p.costoHora}${p.sueldoMensual}`} className="grid grid-cols-3 gap-space-xs items-end">
            <select name="funcion" aria-label={`Función de ${p.nombre}`} defaultValue={p.funcionId ?? ''} className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm min-w-0"><option value="">Sin función</option>{(funciones.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select>
            <input name="costo" aria-label={`Bs por hora de ${p.nombre}`} placeholder="Bs/hora" inputMode="decimal" defaultValue={p.costoHora ? Number(p.costoHora) : ''} className="h-12 rounded-lg border border-outline-variant px-space-sm" />
            <input name="sueldo" aria-label={`Sueldo mensual de ${p.nombre}`} placeholder="Sueldo" inputMode="decimal" defaultValue={p.sueldoMensual ? Number(p.sueldoMensual) : ''} className="h-12 rounded-lg border border-outline-variant px-space-sm" />
            <button className="h-12 rounded-lg border border-outline-variant font-semibold col-span-3">Guardar</button></form>}
        </li>))}</ul>
    </section>
  );
}

function CostoVista() {
  const { sucursalId } = useRolesActivos();
  const [r, setR] = useState({ desde: sumar(hoy(), -6), hasta: hoy() });
  const q = useQuery({ queryKey: ['turnos-costo', sucursalId, r], queryFn: () => api.get<Costo>(`/turnos/costo?desde=${r.desde}&hasta=${r.hasta}`, sucursalId!), enabled: !!sucursalId });
  const c = q.data;
  return (
    <section className="flex flex-col gap-space-md">
      <div className="flex flex-wrap items-end gap-space-sm">
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Desde</span><input type="date" value={r.desde} onChange={(e) => setR({ ...r, desde: e.target.value })} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Hasta</span><input type="date" value={r.hasta} onChange={(e) => setR({ ...r, hasta: e.target.value })} className={clases.input} /></label></div>
      {!c ? <p role="status">Cargando…</p> : <>
        <div className="grid grid-cols-2 gap-gutter"><div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md"><p className="font-label-sm uppercase text-on-surface-variant">Pago por horas trabajadas</p><p className="font-headline-sm text-headline-sm text-primary">{bs(c.totalPagoPorHoras)}</p></div>
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md"><p className="font-label-sm uppercase text-on-surface-variant">Costo planificado</p><p className="font-headline-sm text-headline-sm text-primary">{bs(c.totalPlanificado)}</p></div></div>
        <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="w-full text-body-sm"><caption className="text-left p-3 font-headline-sm text-headline-sm">Por persona</caption><thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-3">Persona</th><th className="p-3 text-right">Turnos</th><th className="p-3 text-right">H. prog.</th><th className="p-3 text-right">H. trab.</th><th className="p-3 text-right">Pago</th><th className="p-3 text-right">Planificado</th></tr></thead>
          <tbody>{c.personas.length === 0 ? <tr><td className="p-3 text-on-surface-variant">Sin turnos en el rango.</td></tr> : c.personas.map((p) => <tr key={p.personaId} className="border-t border-outline-variant"><td className="p-3 font-semibold">{p.persona}</td><td className="p-3 text-right">{p.turnos}</td><td className="p-3 text-right">{p.horasProgramadas}</td><td className="p-3 text-right">{p.horasTrabajadas}</td><td className="p-3 text-right">{bs(p.pagoPorHoras)}</td><td className="p-3 text-right">{bs(p.costoPlanificado)}</td></tr>)}</tbody></table></div>
        {c.porEvento.length > 0 && <div className="overflow-x-auto bg-surface-container-lowest border border-outline-variant rounded-xl"><table className="w-full text-body-sm"><caption className="text-left p-3 font-headline-sm text-headline-sm">Por evento</caption><tbody>{c.porEvento.map((e) => <tr key={e.eventoId} className="border-t border-outline-variant"><td className="p-3 font-semibold">{e.evento}</td><td className="p-3 text-right">{e.horas} h</td><td className="p-3 text-right">{bs(e.costoPlanificado)}</td></tr>)}</tbody></table></div>}
      </>}
    </section>
  );
}
