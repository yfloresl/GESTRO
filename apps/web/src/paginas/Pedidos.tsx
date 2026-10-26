import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs, ETIQUETA_ESTADO, ETIQUETA_TIPO, minutosDesde, Pedido } from '../lib/tipos';

interface Mesa { id: string; numero: string; asientos: number; activa: boolean }
interface Categoria { id: string; nombre: string }
interface Plato { id: string; categoriaId: string | null; nombre: string; precio: string; precioVigente?: string; promocion?: string | null; disponible: boolean; descripcion: string | null }

const COLOR: Record<string, string> = { borrador: 'bg-surface-container text-on-surface-variant', enviado: 'bg-primary-fixed text-on-primary-fixed-variant', en_preparacion: 'bg-secondary-fixed text-on-secondary-fixed-variant', listo: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', servido: 'bg-surface-container text-on-surface-variant', cobrado: 'bg-surface-container-high text-on-surface-variant', anulado: 'bg-error-container text-on-error-container', por_confirmar: 'bg-secondary-fixed text-on-secondary-fixed-variant' };
const Chip = ({ estado }: { estado: string }) => <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm uppercase whitespace-nowrap ${COLOR[estado] ?? COLOR.borrador}`}>{ETIQUETA_ESTADO[estado] ?? estado}</span>;

/** Pedidos: lista del día (2.6) y pantalla de toma de pedidos del personal (2.3, 2.4, 2.5, 2.7). */
export function Pedidos() {
  const { sucursalId } = useRolesActivos();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [filtro, setFiltro] = useState<'abiertos' | 'hoy'>('abiertos');
  const lista = useQuery({ queryKey: ['pedidos', sucursalId, filtro], queryFn: () => api.get<Pedido[]>(`/pedidos?filtro=${filtro}`, sucursalId!), enabled: !!sucursalId, refetchInterval: 30_000 });

  if (abierto) return <PedidoDetalle id={abierto} volver={() => setAbierto(null)} />;
  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-end justify-between gap-space-md">
        <div><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Pedidos</h1><p className="font-body-md text-body-md text-on-surface-variant">Mesas, mostrador, para llevar y delivery en un solo lugar.</p></div>
        <button type="button" onClick={() => setNuevo(true)} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">add_circle</span>Nuevo pedido</button>
      </header>
      <div className="flex gap-space-xs" role="tablist" aria-label="Filtro">
        {([['abiertos', 'En curso'], ['hoy', 'Todos los de hoy']] as const).map(([k, n]) => <button key={k} role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k)} className={`h-12 px-space-md rounded-lg font-semibold ${filtro === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}
      </div>
      {lista.isLoading ? <p role="status">Cargando pedidos…</p> : (lista.data ?? []).length === 0 ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-xl text-center"><span className="material-symbols-outlined text-[40px] text-primary" aria-hidden="true">receipt_long</span><h2 className="font-headline-sm text-headline-sm mt-space-xs">No hay pedidos {filtro === 'abiertos' ? 'en curso' : 'hoy'}</h2><p className="text-on-surface-variant">Crea uno con «Nuevo pedido».</p></div>
      ) : (
        <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">
          {lista.data!.map((p) => {
            const pendientes = p.items.filter((i) => i.porConfirmar && !i.anulado).length;
            return (
              <li key={p.id}><button type="button" onClick={() => setAbierto(p.id)} className={`w-full text-left bg-surface-container-lowest border-2 rounded-xl p-space-md flex flex-col gap-space-xs ${pendientes ? 'border-secondary-container' : 'border-outline-variant'} hover:border-primary`}>
                <div className="flex items-center justify-between"><span className="font-headline-sm text-headline-sm text-primary">{p.tipo === 'mesa' ? `Mesa ${p.mesa}` : `${ETIQUETA_TIPO[p.tipo]} #${p.ticket}`}</span><Chip estado={p.estado} /></div>
                <p className="font-body-sm text-body-sm text-on-surface-variant">{p.items.filter((i) => !i.anulado).length} platos · hace {minutosDesde(p.abierto)} min{p.mesero ? ` · ${p.mesero}` : ''}{p.cliente ? ` · ${p.cliente}` : ''}</p>
                {pendientes > 0 && <p className="font-body-sm font-semibold text-on-secondary-fixed-variant flex items-center gap-1"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">qr_code_2</span>{pendientes} por confirmar (pedido del cliente)</p>}
                <p className="font-label-lg text-label-lg text-primary mt-space-xs">{bs(p.total)}</p>
              </button></li>
            );
          })}
        </ul>
      )}
      {nuevo && <NuevoPedido cerrar={() => setNuevo(false)} creado={(id) => { setNuevo(false); setAbierto(id); }} />}
    </div>
  );
}

function NuevoPedido({ cerrar, creado }: { cerrar(): void; creado(id: string): void }) {
  const { sucursalId } = useRolesActivos();
  const [tipo, setTipo] = useState<Pedido['tipo']>('mesa');
  const [error, setError] = useState<string | null>(null);
  const mesas = useQuery({ queryKey: ['mesas', sucursalId], queryFn: () => api.get<Mesa[]>('/mesas', sucursalId!), enabled: !!sucursalId });
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null);
    const f = new FormData(e.currentTarget); const v = (k: string) => String(f.get(k) ?? '').trim();
    try {
      const r = await api.post<{ pedido: Pedido }>('/pedidos', {
        tipo, ...(tipo === 'mesa' ? { mesaId: v('mesa') } : { cliente: { nombre: v('nombre') || undefined, telefono: v('telefono') || undefined, direccion: v('direccion') || undefined, recojo: v('recojo') ? new Date(v('recojo')).toISOString() : undefined } }),
      }, sucursalId!);
      creado(r.pedido.id);
    } catch (err) { setError(mensajeDeError(err)); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Nuevo pedido" className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-inverse-surface/50" onClick={cerrar}>
      <form onSubmit={enviar} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface rounded-t-xl sm:rounded-xl p-space-md flex flex-col gap-space-md">
        <h2 className="font-headline-md text-headline-md text-primary">Nuevo pedido</h2>
        <div className="grid grid-cols-2 gap-space-xs" role="radiogroup" aria-label="Tipo de pedido">
          {(['mesa', 'mostrador', 'llevar', 'delivery'] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)} className={`h-12 rounded-lg font-semibold ${tipo === t ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{ETIQUETA_TIPO[t]}</button>)}
        </div>
        {tipo === 'mesa' ? (
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Mesa</span>
            <select name="mesa" required className={clases.input}><option value="">Elige la mesa</option>{(mesas.data ?? []).filter((m) => m.activa).map((m) => <option key={m.id} value={m.id}>Mesa {m.numero} · {m.asientos} pers</option>)}</select>
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Nombre del cliente</span><input name="nombre" className={clases.input} /></label>
            <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Teléfono{tipo === 'delivery' ? ' (obligatorio)' : ''}</span><input name="telefono" inputMode="tel" required={tipo === 'delivery'} className={clases.input} /></label>
            {tipo === 'delivery' && <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Dirección (obligatoria)</span><input name="direccion" required className={clases.input} /></label>}
            {tipo !== 'mostrador' && <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Hora de {tipo === 'delivery' ? 'entrega' : 'recojo'}</span><input name="recojo" type="datetime-local" className={clases.input} /></label>}
          </>
        )}
        {error && <p role="alert" className="text-error">{error}</p>}
        <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={cerrar} className="h-14 rounded-lg border border-outline-variant font-semibold">Cancelar</button><button className={clases.primario}>Crear</button></div>
      </form>
    </div>
  );
}

function PedidoDetalle({ id, volver }: { id: string; volver(): void }) {
  const { sucursalId, roles, esAdmin } = useRolesActivos();
  const qc = useQueryClient();
  const [cat, setCat] = useState('todas');
  const [nota, setNota] = useState<{ plato: Plato } | null>(null);
  const [anular, setAnular] = useState<string | null>(null);
  const [cobrar, setCobrar] = useState(false);
  const [mover, setMover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puedeAnular = esAdmin || roles.includes('cajero') || roles.includes('area_manager');
  const puedeCobrar = esAdmin || roles.includes('cajero');

  const q = useQuery({ queryKey: ['pedido', sucursalId, id], queryFn: () => api.get<Pedido>(`/pedidos/${id}`, sucursalId!), enabled: !!sucursalId, refetchInterval: 20_000 });
  const cats = useQuery({ queryKey: ['menu-cats', sucursalId], queryFn: () => api.get<Categoria[]>('/menu/categorias', sucursalId!), enabled: !!sucursalId });
  const platos = useQuery({ queryKey: ['menu-platos', sucursalId], queryFn: () => api.get<Plato[]>('/menu/platos', sucursalId!), enabled: !!sucursalId });
  const refrescar = () => { void qc.invalidateQueries({ queryKey: ['pedido', sucursalId, id] }); void qc.invalidateQueries({ queryKey: ['pedidos', sucursalId] }); };
  const accion = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: () => { setError(null); refrescar(); }, onError: (e) => setError(mensajeDeError(e)) });

  const p = q.data;
  const visibles = useMemo(() => (platos.data ?? []).filter((x) => cat === 'todas' || x.categoriaId === cat), [platos.data, cat]);
  if (!p) return <p role="status">Cargando pedido…</p>;
  const cerrado = ['cobrado', 'anulado'].includes(p.estado);
  const vigentes = p.items.filter((i) => !i.anulado);
  const sinEnviar = vigentes.filter((i) => i.estado === 'borrador').length;
  const titulo = p.tipo === 'mesa' ? `Mesa ${p.mesa}` : `${ETIQUETA_TIPO[p.tipo]} #${p.ticket}`;
  const agregar = (plato: Plato, extra?: { nota?: string; modificadores?: string[]; tiempo?: number }) => accion.mutate(() => api.post(`/pedidos/${id}/items`, { items: [{ platoId: plato.id, cantidad: 1, ...extra }] }, sucursalId!));

  return (
    <div className="flex flex-col gap-space-md">
      <header className="flex flex-wrap items-center gap-space-sm">
        <button type="button" onClick={volver} aria-label="Volver a la lista" className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
        <div className="flex-1 min-w-0"><h1 className="font-headline-md text-headline-md text-primary">{titulo}</h1><p className="font-body-sm text-on-surface-variant">{p.cliente ? `${p.cliente} · ` : ''}{p.telefono ?? ''}{p.recojo ? ` · recojo ${new Date(p.recojo).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}` : ''}</p></div>
        <Chip estado={p.estado} />
        {p.tipo === 'mesa' && !cerrado && <button type="button" onClick={() => setMover(true)} className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold">Mover de mesa</button>}
      </header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}

      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-[1fr_24rem]">
        {!cerrado && (
          <section aria-label="Menú" className="flex flex-col gap-space-sm">
            <div className="flex gap-space-xs overflow-x-auto pb-1" role="tablist" aria-label="Categorías">
              {[{ id: 'todas', nombre: 'Todo' }, ...(cats.data ?? [])].map((c) => <button key={c.id} role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)} className={`h-12 px-space-md rounded-lg whitespace-nowrap font-semibold ${cat === c.id ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{c.nombre}</button>)}
            </div>
            <ul className="grid grid-cols-2 gap-space-sm md:grid-cols-3">
              {visibles.map((x) => (
                <li key={x.id} className="relative">
                  <button type="button" disabled={!x.disponible || accion.isPending} onClick={() => agregar(x)} className={`w-full min-h-24 text-left rounded-xl border p-space-sm flex flex-col justify-between gap-1 ${x.disponible ? 'bg-surface-container-lowest border-outline-variant hover:border-primary active:bg-primary-fixed' : 'bg-error-container/40 border-error-container text-on-surface-variant'}`}>
                    <span className={`font-body-md font-semibold leading-tight pr-8 ${x.disponible ? "" : "line-through"}`}>{x.nombre}</span>
                    <span className="font-label-md text-label-md text-primary">{!x.disponible ? 'AGOTADO' : x.precioVigente && Number(x.precioVigente) < Number(x.precio) ? <><s className="text-on-surface-variant font-normal mr-1">{bs(x.precio)}</s>{bs(x.precioVigente)}</> : bs(x.precio)}</span>
                  </button>
                  {x.disponible && <button type="button" aria-label={`Agregar ${x.nombre} con nota`} onClick={() => setNota({ plato: x })} className="absolute top-1 right-1 w-9 h-9 rounded-full text-on-surface-variant hover:bg-surface-container"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">edit_note</span></button>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <aside aria-label="Pedido" className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm h-fit ${cerrado ? 'lg:col-span-2' : 'lg:sticky lg:top-20'}`}>
          <h2 className="font-headline-sm text-headline-sm">Pedido</h2>
          {vigentes.length === 0 ? <p className="text-on-surface-variant">Toca un plato para agregarlo.</p> : (
            <ul className="flex flex-col divide-y divide-outline-variant">
              {p.items.map((i) => (
                <li key={i.id} className={`py-space-sm flex flex-col gap-1 ${i.anulado ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-space-sm">
                    <span className={`font-body-md font-semibold ${i.anulado ? 'line-through' : ''}`}>{Number(i.cantidad)}× {i.nombre}</span>
                    <span className="font-label-md text-label-md whitespace-nowrap">{bs(Number(i.cantidad) * Number(i.precio))}</span>
                  </div>
                  {(i.nota || i.modificadores.length > 0) && <p className="font-body-sm text-body-sm text-on-secondary-fixed-variant bg-secondary-fixed rounded px-2 py-0.5 w-fit">{[...i.modificadores, i.nota].filter(Boolean).join(' · ')}</p>}
                  <div className="flex items-center gap-space-xs flex-wrap">
                    {i.anulado ? <span className="font-label-sm text-label-sm text-error uppercase">Anulado · {i.motivoAnulacion}</span> : <Chip estado={i.porConfirmar ? 'por_confirmar' : i.estado} />}
                    {i.desdeQr && !i.anulado && <span className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-0.5"><span className="material-symbols-outlined text-[14px]" aria-hidden="true">qr_code_2</span>cliente</span>}
                    {!cerrado && !i.anulado && i.estado === 'borrador' && !i.porConfirmar && <button type="button" onClick={() => accion.mutate(() => api.del(`/items/${i.id}`, undefined, sucursalId!))} className="ml-auto h-9 px-2 text-error font-label-md">Quitar</button>}
                    {!cerrado && !i.anulado && i.estado !== 'borrador' && puedeAnular && <button type="button" onClick={() => setAnular(i.id)} className="ml-auto h-9 px-2 text-error font-label-md">Anular</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-outline-variant pt-space-sm"><span className="font-headline-sm text-headline-sm">Total</span><span className="font-headline-md text-headline-md text-primary font-label-lg">{bs(p.total)}</span></div>
          {!cerrado && (
            <div className="flex flex-col gap-space-xs">
              <button type="button" disabled={sinEnviar === 0 || accion.isPending} onClick={() => accion.mutate(() => api.post(`/pedidos/${id}/enviar`, undefined, sucursalId!))} className={clases.primario}><span className="material-symbols-outlined" aria-hidden="true">send</span>{sinEnviar ? `Enviar a cocina (${sinEnviar})` : 'Todo enviado'}</button>
              {puedeCobrar && vigentes.length > 0 && <button type="button" disabled={sinEnviar > 0} onClick={() => setCobrar(true)} className="h-14 rounded-lg bg-secondary-container text-on-secondary-container font-semibold disabled:opacity-50 flex items-center justify-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">payments</span>Cobrar {bs(p.total)}</button>}
            </div>
          )}
          {cerrado && p.estado === 'cobrado' && <ReciboEnlace pedidoId={id} />}
        </aside>
      </div>

      {nota && <HojaNota plato={nota.plato} cerrar={() => setNota(null)} agregar={(extra) => { agregar(nota.plato, extra); setNota(null); }} />}
      {anular && <HojaMotivo titulo="Anular plato" ayuda="El plato ya se envió a cocina: queda registrado quién lo anuló y por qué." cerrar={() => setAnular(null)} confirmar={async (m) => { await api.post(`/items/${anular}/anular`, { motivo: m }, sucursalId!); setAnular(null); refrescar(); }} />}
      {mover && <MoverMesa pedido={p} cerrar={() => setMover(false)} movido={() => { setMover(false); refrescar(); }} />}
      {cobrar && <Cobrar pedido={p} cerrar={() => setCobrar(false)} cobrado={() => { setCobrar(false); refrescar(); }} />}
    </div>
  );
}

function ReciboEnlace({ pedidoId }: { pedidoId: string }) {
  const { sucursalId } = useRolesActivos();
  const r = useQuery({ queryKey: ['recibo-de', pedidoId], queryFn: () => api.get<{ id: string } | null>(`/pedidos/${pedidoId}/recibo`, sucursalId!), enabled: !!sucursalId });
  return r.data?.id ? <Link to={`/app/recibo/${r.data.id}`} className={clases.secundario}>Ver / imprimir recibo</Link> : <p className="text-on-surface-variant font-body-sm">Cobrado sin recibo (solo contabilizado).</p>;
}

function Hoja({ titulo, children, cerrar }: { titulo: string; children: React.ReactNode; cerrar(): void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-inverse-surface/50" onClick={cerrar}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface rounded-t-xl sm:rounded-xl p-space-md flex flex-col gap-space-md max-h-[90vh] overflow-y-auto"><h2 className="font-headline-md text-headline-md text-primary">{titulo}</h2>{children}</div>
    </div>
  );
}

const MODIFICADORES = ['Sin cebolla', 'Sin picante', 'Picante doble', 'Sin ají', 'Punto medio', 'Bien cocido', 'Aparte', 'Para llevar'];
function HojaNota({ plato, cerrar, agregar }: { plato: Plato; cerrar(): void; agregar(extra: { nota?: string; modificadores?: string[]; tiempo?: number }): void }) {
  const [mods, setMods] = useState<string[]>([]); const [nota, setNota] = useState(''); const [tiempo, setTiempo] = useState(1);
  return (
    <Hoja titulo={plato.nombre} cerrar={cerrar}>
      <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Modificadores</legend>
        <div className="flex flex-wrap gap-space-xs">{MODIFICADORES.map((m) => <button key={m} type="button" aria-pressed={mods.includes(m)} onClick={() => setMods((a) => (a.includes(m) ? a.filter((x) => x !== m) : [...a, m]))} className={`h-10 px-space-sm rounded-full border font-label-md ${mods.includes(m) ? 'bg-secondary-container border-secondary-container text-on-secondary-container' : 'border-outline-variant text-on-surface-variant'}`}>{m}</button>)}</div>
      </fieldset>
      <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Nota para cocina</span><input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={200} className={clases.input} /></label>
      <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Tiempo</legend>
        <div className="grid grid-cols-3 gap-space-xs">{[[1, 'Entrada'], [2, 'Fondo'], [3, 'Postre']].map(([n, t]) => <button key={n} type="button" aria-pressed={tiempo === n} onClick={() => setTiempo(Number(n))} className={`h-12 rounded-lg font-semibold ${tiempo === n ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{t}</button>)}</div>
      </fieldset>
      <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={cerrar} className="h-14 rounded-lg border border-outline-variant font-semibold">Cancelar</button><button type="button" onClick={() => agregar({ nota: nota.trim() || undefined, modificadores: mods.length ? mods : undefined, tiempo })} className={clases.primario}>Agregar</button></div>
    </Hoja>
  );
}

function HojaMotivo({ titulo, ayuda, cerrar, confirmar }: { titulo: string; ayuda: string; cerrar(): void; confirmar(motivo: string): Promise<void> }) {
  const [m, setM] = useState(''); const [error, setError] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false);
  return (
    <Hoja titulo={titulo} cerrar={cerrar}>
      <p className="text-on-surface-variant">{ayuda}</p>
      <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Motivo (obligatorio)</span><input value={m} onChange={(e) => setM(e.target.value)} maxLength={200} className={clases.input} autoFocus /></label>
      {error && <p role="alert" className="text-error">{error}</p>}
      <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={cerrar} className="h-14 rounded-lg border border-outline-variant font-semibold">Cancelar</button>
        <button type="button" disabled={m.trim().length < 3 || ocupado} onClick={async () => { setOcupado(true); try { await confirmar(m.trim()); } catch (e) { setError(mensajeDeError(e)); setOcupado(false); } }} className="h-14 rounded-lg bg-error text-on-error font-semibold disabled:opacity-50">Confirmar</button></div>
    </Hoja>
  );
}

function MoverMesa({ pedido, cerrar, movido }: { pedido: Pedido; cerrar(): void; movido(): void }) {
  const { sucursalId } = useRolesActivos(); const [error, setError] = useState<string | null>(null);
  const mesas = useQuery({ queryKey: ['mesas', sucursalId], queryFn: () => api.get<Mesa[]>('/mesas', sucursalId!), enabled: !!sucursalId });
  return (
    <Hoja titulo="Mover a otra mesa" cerrar={cerrar}>
      <div className="grid grid-cols-3 gap-space-xs">{(mesas.data ?? []).filter((m) => m.activa && m.id !== pedido.mesaId).map((m) => <button key={m.id} type="button" onClick={async () => { try { await api.post(`/pedidos/${pedido.id}/mover-mesa`, { mesaId: m.id }, sucursalId!); movido(); } catch (e) { setError(mensajeDeError(e)); } }} className="h-14 rounded-lg bg-surface-container font-label-lg">{m.numero}</button>)}</div>
      {error && <p role="alert" className="text-error">{error}</p>}
    </Hoja>
  );
}

const METODOS = [['efectivo', 'Efectivo', 'payments'], ['qr', 'QR', 'qr_code_2'], ['tarjeta', 'Tarjeta', 'credit_card'], ['transferencia', 'Transferencia', 'account_balance'], ['credito', 'Crédito', 'schedule']] as const;
function Cobrar({ pedido, cerrar, cobrado }: { pedido: Pedido; cerrar(): void; cobrado(): void }) {
  const { sucursalId } = useRolesActivos();
  const caja = useQuery({ queryKey: ['caja', sucursalId], queryFn: () => api.get<{ activa: boolean }>('/caja/actual', sucursalId!), enabled: !!sucursalId });
  const aj = useQuery({ queryKey: ['ajustes', sucursalId], queryFn: () => api.get<{ modoDeCobro: string }>('/sucursal/ajustes', sucursalId!).catch(() => ({ modoDeCobro: 'recibo' })), enabled: !!sucursalId });
  const [metodo, setMetodo] = useState<(typeof METODOS)[number][0]>('efectivo');
  const [doc, setDoc] = useState<'recibo' | 'ninguno'>('recibo'); const [cliente, setCliente] = useState(''); const [telefono, setTelefono] = useState(''); const [dias, setDias] = useState('30');
  const [error, setError] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false);
  const soloContabilizar = aj.data?.modoDeCobro === 'ninguno';
  const cobrar = async () => {
    setError(null);
    if (metodo === 'credito' && !cliente.trim()) { setError('Escribe el nombre del cliente: la venta a crédito queda como cuenta por cobrar.'); return; }
    setOcupado(true);
    try {
      const r = await api.post<{ recibo: number | null }>(`/pedidos/${pedido.id}/cobrar`, { metodo, documento: soloContabilizar ? 'ninguno' : doc, nombreCliente: cliente.trim() || undefined, ...(metodo === 'credito' ? { telefonoCliente: telefono.trim() || undefined, diasCredito: Math.max(0, Math.min(365, Math.round(Number(dias) || 0))) } : {}) }, sucursalId!);
      cobrado(); if (r.recibo) { /* el recibo queda disponible desde el pedido */ }
    } catch (e) { setError(mensajeDeError(e)); setOcupado(false); }
  };
  return (
    <Hoja titulo={`Cobrar ${bs(pedido.total)}`} cerrar={cerrar}>
      {caja.data && !caja.data.activa && <p role="alert" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm">Abre tu caja antes de cobrar. <Link to="/app/caja" className="underline font-semibold">Ir a Caja</Link></p>}
      <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Método de pago</legend>
        <div className="grid grid-cols-2 gap-space-xs">{METODOS.map(([k, n, ic]) => <button key={k} type="button" role="radio" aria-checked={metodo === k} onClick={() => setMetodo(k)} className={`h-14 rounded-lg font-semibold flex items-center justify-center gap-space-xs ${metodo === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}><span className="material-symbols-outlined" aria-hidden="true">{ic}</span>{n}</button>)}</div>
      </fieldset>
      <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Documento</legend>
        <div className="grid grid-cols-2 gap-space-xs">
          {!soloContabilizar && <button type="button" role="radio" aria-checked={doc === 'recibo'} onClick={() => setDoc('recibo')} className={`h-12 rounded-lg font-semibold ${doc === 'recibo' ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>Recibo</button>}
          <button type="button" role="radio" aria-checked={soloContabilizar || doc === 'ninguno'} onClick={() => setDoc('ninguno')} className={`h-12 rounded-lg font-semibold ${soloContabilizar || doc === 'ninguno' ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>Solo contabilizar</button>
        </div>
        <p className="font-body-sm text-on-surface-variant">La factura electrónica del SIN estará disponible cuando se conecte el Servicio Fiscal.</p>
      </fieldset>
      <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>{metodo === 'credito' ? 'Nombre del cliente (obligatorio)' : 'Nombre en el recibo (opcional)'}</span><input value={cliente} onChange={(e) => setCliente(e.target.value)} required={metodo === 'credito'} className={clases.input} /></label>
      {metodo === 'credito' && <div className="grid grid-cols-2 gap-space-sm"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Teléfono (opcional)</span><input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" className={clases.input} /></label><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Plazo (días)</span><input value={dias} onChange={(e) => setDias(e.target.value)} inputMode="numeric" className={clases.input} /></label></div>}
      {error && <p role="alert" className="text-error">{error}</p>}
      <div className="grid grid-cols-2 gap-space-sm"><button type="button" onClick={cerrar} className="h-14 rounded-lg border border-outline-variant font-semibold">Cancelar</button><button type="button" disabled={ocupado || caja.data?.activa === false} onClick={cobrar} className={clases.primario}>{ocupado ? 'Cobrando…' : 'Confirmar cobro'}</button></div>
    </Hoja>
  );
}
