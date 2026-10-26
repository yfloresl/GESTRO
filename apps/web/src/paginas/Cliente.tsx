import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Cargando } from '../componentes/Marca';

interface PlatoPub { id: string; nombre: string; descripcion: string | null; precio: string; precioVigente?: string; promocion?: string | null; alergenos: string[]; disponible: boolean; minutosPreparacion: number | null; foto: string | null }
interface MenuPub { restaurante: { nombre: string; slug: string; pedidosQr?: boolean }; categorias: { id: string | null; nombre: string; platos: PlatoPub[] }[] }
interface Mesa { token: string; mesa: { numero: string }; restaurante: { nombre: string; slug: string } }
interface Estado { id: string; tipo: 'atencion' | 'cuenta' | 'servicio'; estado: 'pendiente' | 'atendida' | 'cancelada'; creada: string }
type Tipo = Estado['tipo'];
interface MiPedido { total: string; items: { nombre: string; cantidad: string; estado: string; nota: string | null }[] }
const AVANCE: Record<string, { texto: string; clase: string }> = {
  por_confirmar: { texto: 'Esperando al mesero', clase: 'bg-secondary-fixed text-on-secondary-fixed-variant' },
  borrador: { texto: 'Esperando al mesero', clase: 'bg-secondary-fixed text-on-secondary-fixed-variant' },
  enviado: { texto: 'Recibido en cocina', clase: 'bg-primary-fixed text-on-primary-fixed-variant' },
  en_preparacion: { texto: 'En preparación', clase: 'bg-secondary-container text-on-secondary-container' },
  listo: { texto: '¡Listo!', clase: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' },
  servido: { texto: 'Servido', clase: 'bg-surface-container text-on-surface-variant' },
};

const ALERGENO: Record<string, string> = { gluten: 'Gluten', lacteos: 'Lácteos', huevo: 'Huevo', pescado: 'Pescado', mariscos: 'Mariscos', mani: 'Maní', frutos_secos: 'Frutos secos', soya: 'Soya', apio: 'Apio', mostaza: 'Mostaza', sesamo: 'Sésamo', sulfitos: 'Sulfitos' };
const ACCION: Record<Tipo, { texto: string; icono: string; enviado: string; hecho: string }> = {
  atencion: { texto: 'Llamar mesero', icono: 'notifications_active', enviado: 'Avisamos a tu mesero. En un momento te atienden.', hecho: 'Tu mesero ya fue atendido' },
  cuenta: { texto: 'Pedir la cuenta', icono: 'receipt_long', enviado: 'Pedimos tu cuenta. Enseguida te la llevan.', hecho: 'Tu cuenta va en camino' },
  servicio: { texto: 'Pedir servicio', icono: 'room_service', enviado: 'Recibimos tu pedido de servicio.', hecho: 'Servicio atendido' },
};
const bs = (n: string) => `Bs ${Number(n).toFixed(2)}`;

/**
 * PWA del cliente (pantalla 1.1): se abre al escanear el QR de la mesa, sin instalar nada y sin Kyros ID.
 * El QR se cambia por un token de mesa de 4 h que solo sirve para esta mesa.
 */
export function Cliente() {
  const { qr } = useParams();
  const [mesa, setMesa] = useState<Mesa | null>(null);
  const [menu, setMenu] = useState<MenuPub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estados, setEstados] = useState<Estado[]>([]);
  const [hoja, setHoja] = useState<Tipo | null>(null);
  const [cat, setCat] = useState<string>('todas');
  const [busca, setBusca] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [carro, setCarro] = useState<Record<string, number>>({});
  const [verPedido, setVerPedido] = useState(false);
  const [mio, setMio] = useState<MiPedido | null>(null);
  const token = useRef<string>('');

  const llamar = useCallback(async (ruta: string, init?: RequestInit) => {
    const r = await fetch(`/api/v1/qr/${ruta}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token.current}` } });
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(cuerpo?.message ?? 'No pudimos completar la acción.'), { status: r.status });
    return cuerpo;
  }, []);
  const refrescar = useCallback(() => Promise.all([llamar('estado').then(setEstados), llamar('pedido').then((r) => setMio(r.pedido))]).catch(() => undefined), [llamar]);

  useEffect(() => {
    let cierre = () => {};
    (async () => {
      try {
        const s = await fetch('/api/v1/qr/sesion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ qrToken: qr }) });
        if (!s.ok) throw new Error('Este QR no está disponible. Pide ayuda a tu mesero.');
        const m = (await s.json()) as Mesa; token.current = m.token; setMesa(m);
        const mr = await fetch(`/api/v1/public/${m.restaurante.slug}/menu`);
        if (!mr.ok) throw new Error('No pudimos cargar el menú.');
        setMenu(await mr.json());
        await refrescar();
        const socket = io({ path: '/api/socket.io', auth: { token: m.token }, transports: ['websocket', 'polling'] });
        socket.on('solicitud.estado', () => { void refrescar(); });
        socket.on('pedido.estado', () => { void refrescar(); });
        cierre = () => socket.close();
      } catch (e) { setError((e as Error).message); }
    })();
    const poll = setInterval(() => { if (token.current) void refrescar(); }, 20_000);
    return () => { cierre(); clearInterval(poll); };
  }, [qr, refrescar]);

  const abiertas = (t: Tipo) => estados.find((e) => e.tipo === t && e.estado === 'pendiente');
  const reciente = (t: Tipo) => estados.find((e) => e.tipo === t && e.estado === 'atendida' && Date.now() - new Date(e.creada).getTime() < 10 * 60_000);
  const categorias = menu?.categorias ?? [];
  const platos = useMemo(() => categorias.filter((c) => cat === 'todas' || (c.id ?? 'otros') === cat).map((c) => ({ ...c, platos: c.platos.filter((p) => p.nombre.toLowerCase().includes(busca.toLowerCase())) })).filter((c) => c.platos.length), [categorias, cat, busca]);

  if (error) return <main className="min-h-screen flex items-center justify-center p-margin text-center"><p role="alert" className="text-error font-body-lg">{error}</p></main>;
  if (!mesa || !menu) return <Cargando texto="Abriendo el menú…" />;

  const enviar = async (tipo: Tipo, comentario: string) => {
    try { await llamar('solicitudes', { method: 'POST', body: JSON.stringify({ tipo, ...(comentario ? { comentario } : {}) }) }); setAviso(ACCION[tipo].enviado); await refrescar(); }
    catch (e) { setAviso((e as { status?: number }).status === 409 ? 'Ya avisaste. En un momento te atienden.' : (e as Error).message); }
    setHoja(null); setTimeout(() => setAviso(null), 6000);
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col pb-44">
      <header className="sticky top-0 z-20 bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] px-margin py-space-sm flex items-center gap-space-sm">
        <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-on-primary" aria-hidden="true"><span className="material-symbols-outlined">restaurant</span></div>
        <div className="min-w-0"><h1 className="font-headline-sm text-headline-sm text-primary leading-tight truncate">{mesa.restaurante.nombre}</h1><p className="font-label-md text-label-md text-tertiary flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-tertiary-container" aria-hidden="true" />Mesa {mesa.mesa.numero}</p></div>
      </header>

      <div className="px-margin pt-space-md flex flex-col gap-space-sm">
        <label className="relative block"><span className="sr-only">Buscar en el menú</span>
          <span className="material-symbols-outlined absolute left-3 top-3.5 text-on-surface-variant" aria-hidden="true">search</span>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar en el menú" className="h-[52px] w-full rounded-lg bg-surface-container-lowest border border-outline-variant pl-11 pr-space-md font-body-md focus:outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <div className="flex gap-space-sm overflow-x-auto -mx-margin px-margin pb-1" role="tablist" aria-label="Categorías">
          {[{ id: 'todas', nombre: 'Todo' }, ...categorias.map((c) => ({ id: c.id ?? 'otros', nombre: c.nombre }))].map((c) => (
            <button key={c.id} role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)} className={`h-12 px-space-md rounded-full whitespace-nowrap font-body-md font-semibold ${cat === c.id ? 'bg-primary-container text-on-primary' : 'bg-surface-container-lowest border border-outline-variant text-on-surface'}`}>{c.nombre}</button>
          ))}
        </div>
      </div>

      <main className="px-margin pt-space-md flex flex-col gap-space-lg">
        {platos.length === 0 && <p className="text-center text-on-surface-variant py-space-xl">{menu.categorias.length ? 'No encontramos platos con esa búsqueda.' : 'El menú todavía no tiene platos.'}</p>}
        {platos.map((c) => (
          <section key={c.id ?? 'otros'} aria-label={c.nombre} className="flex flex-col gap-space-sm">
            <h2 className="font-headline-sm text-headline-sm text-on-surface">{c.nombre}</h2>
            <ul className="flex flex-col gap-space-sm">
              {c.platos.map((p) => (
                <li key={p.id} className={`rounded-xl border border-outline-variant bg-surface-container-lowest p-space-sm flex gap-space-sm ${p.disponible ? '' : 'opacity-60'}`}>
                  <div className="w-28 h-28 shrink-0 rounded-lg bg-surface-container overflow-hidden flex items-center justify-center">
                    {p.foto ? <img src={p.foto} alt={p.nombre} loading="lazy" className={`w-full h-full object-cover ${p.disponible ? '' : 'grayscale'}`} /> : <span className="material-symbols-outlined text-on-surface-variant text-[32px]" aria-hidden="true">restaurant</span>}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <h3 className="font-headline-sm text-headline-sm leading-tight">{p.nombre}</h3>
                    {p.descripcion && <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-3">{p.descripcion}</p>}
                    <div className="flex flex-wrap gap-1">
                      {!p.disponible && <span className="px-2 py-0.5 rounded bg-error-container text-on-error-container font-label-sm text-label-sm uppercase">Agotado hoy</span>}
                      {p.alergenos.map((a) => <span key={a} className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-on-surface-variant">{ALERGENO[a] ?? a}</span>)}
                    </div>
                    <div className="flex items-end justify-between gap-space-xs mt-auto">
                      <p className="font-label-lg text-label-lg text-primary whitespace-nowrap">{p.precioVigente && Number(p.precioVigente) < Number(p.precioVigente ?? p.precio) ? <><s className="text-on-surface-variant font-normal mr-1">{bs(p.precio)}</s>{bs(p.precioVigente)}</> : bs(p.precio)}</p>{p.promocion && p.precioVigente && Number(p.precioVigente) < Number(p.precioVigente ?? p.precio) && <p className="font-label-sm text-label-sm text-tertiary">{p.promocion}</p>}
                      {menu.restaurante.pedidosQr && p.disponible && (carro[p.id] ? (
                        <div className="flex items-center gap-1" role="group" aria-label={`Cantidad de ${p.nombre}`}>
                          <button type="button" aria-label={`Quitar uno de ${p.nombre}`} onClick={() => setCarro((c) => { const n = { ...c, [p.id]: (c[p.id] ?? 0) - 1 }; if (n[p.id] <= 0) delete n[p.id]; return n; })} className="w-12 h-12 rounded-lg bg-surface-container text-primary font-bold text-xl">−</button>
                          <span className="w-8 text-center font-label-lg">{carro[p.id]}</span>
                          <button type="button" aria-label={`Agregar otro ${p.nombre}`} onClick={() => setCarro((c) => ({ ...c, [p.id]: Math.min(20, (c[p.id] ?? 0) + 1) }))} className="w-12 h-12 rounded-lg bg-primary-container text-on-primary font-bold text-xl">+</button>
                        </div>
                      ) : <button type="button" onClick={() => setCarro((c) => ({ ...c, [p.id]: 1 }))} className="h-12 px-space-md rounded-lg bg-primary-container text-on-primary font-semibold flex items-center gap-1"><span className="material-symbols-outlined" aria-hidden="true">add</span>Agregar</button>)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      <div className="fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur-xl border-t border-outline-variant px-margin pt-space-sm pb-[max(env(safe-area-inset-bottom),0.75rem)] flex flex-col gap-space-sm">
        {aviso && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant px-space-md py-space-sm font-body-sm text-body-sm">{aviso}</p>}
        {(['atencion', 'cuenta', 'servicio'] as Tipo[]).map((t) => abiertas(t) && (
          <p key={t} role="status" className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant"><span className="material-symbols-outlined text-secondary animate-pulse" aria-hidden="true">hourglass_top</span>{ACCION[t].enviado}</p>
        ))}
        {(['atencion', 'cuenta', 'servicio'] as Tipo[]).map((t) => !abiertas(t) && reciente(t) && (
          <p key={t} role="status" className="flex items-center gap-space-xs font-body-sm text-body-sm text-tertiary"><span className="material-symbols-outlined" aria-hidden="true">check_circle</span>{ACCION[t].hecho}</p>
        ))}
        {menu.restaurante.pedidosQr && (Object.keys(carro).length > 0 || (mio && mio.items.length > 0)) && (
          <button type="button" onClick={() => setVerPedido(true)} className="min-h-14 rounded-lg bg-primary-container text-on-primary px-space-md flex items-center justify-between gap-space-sm text-left">
            <span className="flex items-center gap-space-xs font-semibold"><span className="material-symbols-outlined" aria-hidden="true">shopping_basket</span>{Object.keys(carro).length > 0 ? `Ver mi pedido (${Object.values(carro).reduce((a, b) => a + b, 0)})` : 'Mi pedido'}</span>
            <span className="font-label-lg text-label-lg">{Object.keys(carro).length > 0 ? bs(String(menu.categorias.flatMap((c) => c.platos).reduce((t, p) => t + (carro[p.id] ?? 0) * Number(p.precioVigente ?? p.precio), 0))) : mio ? (Number(mio.total) > 0 ? bs(mio.total) : 'Esperando al mesero') : ''}</span>
          </button>
        )}
        <div className="grid grid-cols-2 gap-space-sm">
          {(['atencion', 'cuenta'] as Tipo[]).map((t) => (
            <button key={t} type="button" disabled={!!abiertas(t)} onClick={() => setHoja(t)} className="min-h-14 rounded-lg bg-surface-container-high text-on-surface font-body-md font-semibold flex items-center justify-center gap-space-xs px-space-sm disabled:opacity-50"><span className="material-symbols-outlined" aria-hidden="true">{ACCION[t].icono}</span>{ACCION[t].texto}</button>
          ))}
        </div>
      </div>

      {verPedido && <HojaPedido menu={menu} carro={carro} setCarro={setCarro} mio={mio} cerrar={() => setVerPedido(false)} enviar={async (comentario) => {
        const items = Object.entries(carro).map(([platoId, cantidad]) => ({ platoId, cantidad }));
        const r = await llamar('pedidos', { method: 'POST', body: JSON.stringify({ items, ...(comentario ? { comentario } : {}) }) });
        setCarro({}); setAviso(r.estado === 'enviado' ? 'Tu pedido llegó a cocina.' : 'Pedido enviado. El mesero lo confirmará en un momento.'); await refrescar(); setVerPedido(false); setTimeout(() => setAviso(null), 6000);
      }} />}
      {hoja && <HojaSolicitud tipo={hoja} cerrar={() => setHoja(null)} enviar={(c) => enviar(hoja, c)} />}
    </div>
  );
}

function HojaSolicitud({ tipo, cerrar, enviar }: { tipo: Tipo; cerrar(): void; enviar(comentario: string): Promise<void> }) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={ACCION[tipo].texto} className="fixed inset-0 z-40 flex items-end bg-inverse-surface/50" onClick={cerrar}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); setEnviando(true); await enviar(texto.trim()); }} className="w-full bg-surface rounded-t-xl p-margin flex flex-col gap-space-md pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <h2 className="font-headline-md text-headline-md text-primary flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">{ACCION[tipo].icono}</span>{ACCION[tipo].texto}</h2>
        <label className="flex flex-col gap-space-xs"><span className="font-label-md text-label-md text-on-surface-variant uppercase">Comentario (opcional)</span>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={300} rows={3} placeholder="Ej.: faltan cubiertos, sin picante…" className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-space-sm font-body-lg focus:outline-none focus:ring-2 focus:ring-primary" />
          <span className="text-right font-label-sm text-label-sm text-on-surface-variant">{texto.length}/300</span>
        </label>
        <div className="grid grid-cols-2 gap-space-sm">
          <button type="button" onClick={cerrar} className="h-14 rounded-lg border border-outline-variant font-semibold">Cancelar</button>
          <button disabled={enviando} className="h-14 rounded-lg bg-primary text-on-primary font-semibold">{enviando ? 'Enviando…' : 'Enviar'}</button>
        </div>
      </form>
    </div>
  );
}

function HojaPedido({ menu, carro, setCarro, mio, cerrar, enviar }: { menu: MenuPub; carro: Record<string, number>; setCarro: (f: (c: Record<string, number>) => Record<string, number>) => void; mio: MiPedido | null; cerrar(): void; enviar(comentario: string): Promise<void> }) {
  const [texto, setTexto] = useState(''); const [error, setError] = useState<string | null>(null); const [enviando, setEnviando] = useState(false);
  const platos = menu.categorias.flatMap((c) => c.platos);
  const lineas = Object.entries(carro).map(([id, n]) => ({ p: platos.find((x) => x.id === id)!, n })).filter((l) => l.p);
  const total = lineas.reduce((t, l) => t + l.n * Number(l.p.precioVigente ?? l.p.precio), 0);
  return (
    <div role="dialog" aria-modal="true" aria-label="Mi pedido" className="fixed inset-0 z-40 flex items-end bg-inverse-surface/50" onClick={cerrar}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-h-[90vh] overflow-y-auto bg-surface rounded-t-xl p-margin flex flex-col gap-space-md pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">Mi pedido</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        {mio && mio.items.length > 0 && (
          <section aria-label="Ya pedido" className="flex flex-col gap-space-xs"><h3 className="font-label-md text-label-md text-on-surface-variant uppercase">Ya pedido</h3>
            <ul className="flex flex-col gap-space-xs">{mio.items.map((i, k) => <li key={k} className="flex items-center justify-between gap-space-sm rounded-lg bg-surface-container-lowest border border-outline-variant p-space-sm"><span className="font-body-md">{Number(i.cantidad)}× {i.nombre}</span><span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm whitespace-nowrap ${(AVANCE[i.estado] ?? AVANCE.enviado).clase}`}>{(AVANCE[i.estado] ?? AVANCE.enviado).texto}</span></li>)}</ul>
          </section>
        )}
        {lineas.length > 0 && (
          <form onSubmit={async (e) => { e.preventDefault(); setError(null); setEnviando(true); try { await enviar(texto.trim()); } catch (er) { setError((er as Error).message); setEnviando(false); } }} className="flex flex-col gap-space-sm">
            <h3 className="font-label-md text-label-md text-on-surface-variant uppercase">Por enviar</h3>
            <ul className="flex flex-col gap-space-xs">{lineas.map((l) => <li key={l.p.id} className="flex items-center justify-between gap-space-sm"><span>{l.n}× {l.p.nombre}</span><span className="font-label-md">{bs(String(l.n * Number(l.p.precioVigente ?? l.p.precio)))}</span></li>)}</ul>
            <label className="flex flex-col gap-space-xs"><span className="font-label-md text-label-md text-on-surface-variant uppercase">Comentario (alergias, sin picante…)</span><textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={300} rows={2} className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-space-sm font-body-lg focus:outline-none focus:ring-2 focus:ring-primary" /></label>
            {error && <p role="alert" className="text-error">{error}</p>}
            <div className="flex gap-space-sm"><button type="button" onClick={() => setCarro(() => ({}))} className="h-14 px-space-md rounded-lg border border-outline-variant font-semibold">Vaciar</button><button disabled={enviando} className="flex-1 h-14 rounded-lg bg-primary text-on-primary font-semibold">{enviando ? 'Enviando…' : `Enviar pedido · ${bs(String(total))}`}</button></div>
          </form>
        )}
        {lineas.length === 0 && (!mio || mio.items.length === 0) && <p className="text-on-surface-variant">Aún no agregaste platos.</p>}
      </div>
    </div>
  );
}
