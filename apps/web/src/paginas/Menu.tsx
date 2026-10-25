import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';

interface Categoria { id: string; nombre: string; orden: number }
interface Plato { id: string; categoriaId: string | null; nombre: string; descripcion: string | null; precio: string; alergenos: string[]; minutosPreparacion: number | null; disponible: boolean; tieneFoto: boolean }
const ALERGENOS: [string, string][] = [['gluten', 'Gluten'], ['lacteos', 'Lácteos'], ['huevo', 'Huevo'], ['pescado', 'Pescado'], ['mariscos', 'Mariscos'], ['mani', 'Maní'], ['frutos_secos', 'Frutos secos'], ['soya', 'Soya'], ['apio', 'Apio'], ['mostaza', 'Mostaza'], ['sesamo', 'Sésamo'], ['sulfitos', 'Sulfitos']];

/** Reduce la foto en el navegador (máx. 1280 px, JPEG) antes de subirla: el servidor no procesa imágenes pesadas. */
async function reducir(archivo: File): Promise<Blob> {
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('imagen'))), 'image/jpeg', 0.85));
}

export const bs = (n: string | number) => `Bs ${Number(n).toFixed(2)}`;

/** Menú & Fotos (pantalla 5.2 del diseño): lista de platos y ficha de edición. */
export function Menu() {
  const { sucursalId, esAdmin, roles } = useRolesActivos();
  const qc = useQueryClient();
  const puedeEditar = esAdmin;
  const puedeDisponibilidad = esAdmin || roles.includes('cocina');
  const cats = useQuery({ queryKey: ['menu-cats', sucursalId], queryFn: () => api.get<Categoria[]>('/menu/categorias', sucursalId!), enabled: !!sucursalId });
  const platos = useQuery({ queryKey: ['menu-platos', sucursalId], queryFn: () => api.get<Plato[]>('/menu/platos', sucursalId!), enabled: !!sucursalId });
  const [filtro, setFiltro] = useState<string>('todos');
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<Plato | 'nuevo' | null>(null);
  const [nuevaCat, setNuevaCat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refrescar = () => { void qc.invalidateQueries({ queryKey: ['menu-platos', sucursalId] }); void qc.invalidateQueries({ queryKey: ['menu-cats', sucursalId] }); };

  const alternar = useMutation({ mutationFn: (p: Plato) => api.patch(`/menu/platos/${p.id}`, { disponible: !p.disponible }, sucursalId!), onSuccess: refrescar, onError: (e) => setError(mensajeDeError(e)) });
  const crearCat = useMutation({ mutationFn: () => api.post('/menu/categorias', { nombre: nuevaCat }, sucursalId!), onSuccess: () => { setNuevaCat(''); refrescar(); }, onError: (e) => setError(mensajeDeError(e)) });

  const lista = (platos.data ?? []).filter((p) => (filtro === 'todos' || p.categoriaId === filtro) && p.nombre.toLowerCase().includes(busca.toLowerCase()));

  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-wrap items-end justify-between gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Menú &amp; Fotos</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">Lo que ve el cliente al escanear el QR de su mesa. Los cambios se ven en menos de un minuto.</p>
        </div>
        {puedeEditar && <button type="button" onClick={() => setEditando('nuevo')} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">add_circle</span>Nuevo plato</button>}
      </header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}

      <div className="bg-surface-container-low rounded-xl p-space-md flex flex-col gap-space-sm">
        <div className="flex flex-wrap gap-space-sm items-center">
          <label className="relative flex-1 min-w-[12rem]">
            <span className="sr-only">Buscar plato</span>
            <span className="material-symbols-outlined absolute left-3 top-3 text-on-surface-variant" aria-hidden="true">search</span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre" className={`${clases.input} pl-11 h-12`} />
          </label>
          <div className="flex flex-wrap gap-space-xs" role="tablist" aria-label="Categorías">
            {[{ id: 'todos', nombre: 'Todos' }, ...(cats.data ?? [])].map((c) => (
              <button key={c.id} role="tab" aria-selected={filtro === c.id} onClick={() => setFiltro(c.id)} className={`h-12 px-space-md rounded-lg font-label-md text-label-md ${filtro === c.id ? 'bg-surface-container-lowest text-primary shadow-sm font-semibold' : 'text-on-surface-variant hover:bg-surface-container'}`}>{c.nombre}</button>
            ))}
          </div>
        </div>
        {puedeEditar && (
          <form className="flex gap-space-sm" onSubmit={(e: FormEvent) => { e.preventDefault(); if (nuevaCat.trim()) crearCat.mutate(); }}>
            <input aria-label="Nueva categoría" value={nuevaCat} onChange={(e) => setNuevaCat(e.target.value)} placeholder="Nueva categoría (Sopas, Bebidas…)" className={`${clases.input} h-12 max-w-xs`} />
            <button className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold">Agregar</button>
          </form>
        )}
      </div>

      {platos.isLoading ? <p role="status">Cargando menú…</p> : lista.length === 0 ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-xl text-center">
          <span className="material-symbols-outlined text-[40px] text-primary" aria-hidden="true">menu_book</span>
          <h2 className="font-headline-sm text-headline-sm mt-space-xs">{platos.data?.length ? 'Ningún plato coincide' : 'Tu menú está vacío'}</h2>
          <p className="text-on-surface-variant">{platos.data?.length ? 'Prueba con otra búsqueda o categoría.' : puedeEditar ? 'Agrega tu primer plato con su foto y precio.' : 'Pide al administrador que cargue los platos.'}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
          {lista.map((p) => (
            <li key={p.id} className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex gap-space-md ${p.disponible ? '' : 'opacity-70'}`}>
              <FotoPlato id={p.id} tiene={p.tieneFoto} />
              <div className="flex-1 min-w-0 flex flex-col gap-space-xs">
                <div className="flex items-start justify-between gap-space-sm">
                  <h2 className="font-body-lg text-body-lg font-semibold text-on-surface truncate">{p.nombre}</h2>
                  <span className="font-label-lg text-label-lg text-primary whitespace-nowrap">{bs(p.precio)}</span>
                </div>
                {p.descripcion && <p className="font-body-sm text-body-sm text-on-surface-variant line-clamp-2">{p.descripcion}</p>}
                <div className="flex flex-wrap gap-1">{p.alergenos.map((a) => <span key={a} className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-on-surface-variant">{ALERGENOS.find((x) => x[0] === a)?.[1] ?? a}</span>)}</div>
                <div className="flex items-center justify-between mt-auto pt-space-xs">
                  <label className="flex items-center gap-space-xs font-label-md text-label-md text-on-surface-variant">
                    <button type="button" role="switch" aria-checked={p.disponible} disabled={!puedeDisponibilidad || alternar.isPending} onClick={() => alternar.mutate(p)} className={`w-12 h-7 rounded-full p-0.5 transition-colors ${p.disponible ? 'bg-primary-container' : 'bg-outline-variant'} disabled:opacity-50`}>
                      <span className={`block w-6 h-6 rounded-full bg-white transition-transform ${p.disponible ? 'translate-x-5' : ''}`} />
                    </button>
                    {p.disponible ? 'Disponible' : 'Agotado'}
                  </label>
                  {puedeEditar && <button type="button" onClick={() => setEditando(p)} className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold">Editar</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editando && <FichaPlato plato={editando === 'nuevo' ? null : editando} categorias={cats.data ?? []} cerrar={() => setEditando(null)} guardado={() => { setEditando(null); refrescar(); }} />}
    </div>
  );
}

function FotoPlato({ id, tiene }: { id: string; tiene: boolean }) {
  // La foto se sirve por el menú público: el slug de la sucursal viaja en la lista de sucursales de la sesión (ver Cliente).
  const { sesion } = useRolesActivosConSlug();
  const slug = sesion?.slug;
  return (
    <div className="w-24 h-24 shrink-0 rounded-lg bg-surface-container flex items-center justify-center overflow-hidden">
      {tiene && slug ? <img src={`/api/v1/public/${slug}/foto/${id}`} alt="" loading="lazy" className="w-full h-full object-cover" /> : <span className="material-symbols-outlined text-on-surface-variant" aria-hidden="true">restaurant</span>}
    </div>
  );
}

/** El slug de la sucursal activa (para armar la URL pública de la foto) se pide una sola vez. */
function useRolesActivosConSlug() {
  const { sucursalId } = useRolesActivos();
  const q = useQuery({ queryKey: ['sucursal', sucursalId], queryFn: () => api.sucursal(sucursalId!), enabled: !!sucursalId, staleTime: 5 * 60_000 });
  return { sesion: q.data ? { slug: q.data.slug } : null, sucursalId };
}

function FichaPlato({ plato, categorias, cerrar, guardado }: { plato: Plato | null; categorias: Categoria[]; cerrar(): void; guardado(): void }) {
  const { sucursalId } = useRolesActivos();
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [alergenos, setAlergenos] = useState<string[]>(plato?.alergenos ?? []);
  const [foto, setFoto] = useState<File | null>(null);
  const previa = foto ? URL.createObjectURL(foto) : null;

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); setTrabajando(true);
    const f = new FormData(e.currentTarget);
    const cuerpo = {
      nombre: String(f.get('nombre')).trim(), descripcion: String(f.get('descripcion')).trim() || null, categoriaId: String(f.get('categoria')) || null,
      precio: Number(String(f.get('precio')).replace(',', '.')), minutosPreparacion: f.get('minutos') ? Number(f.get('minutos')) : null, alergenos,
      disponible: f.get('disponible') === 'on',
    };
    try {
      const r = plato ? await api.patch<Plato>(`/menu/platos/${plato.id}`, cuerpo, sucursalId!) : await api.post<Plato>('/menu/platos', cuerpo, sucursalId!);
      if (foto) await api.subirImagen(`/menu/platos/${r.id}/foto`, await reducir(foto), sucursalId!);
      guardado();
    } catch (err) { setError(mensajeDeError(err, 'No pudimos guardar el plato.')); } finally { setTrabajando(false); }
  };
  const borrar = async () => {
    if (!plato || !confirm(`¿Borrar «${plato.nombre}»? Esta acción no se puede deshacer.`)) return;
    try { await api.del(`/menu/platos/${plato.id}`, undefined, sucursalId!); guardado(); } catch (err) { setError(mensajeDeError(err)); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={plato ? `Editar ${plato.nombre}` : 'Nuevo plato'} className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <form onSubmit={enviar} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-md text-headline-md text-primary">{plato ? 'Editar plato' : 'Nuevo plato'}</h2>
          <button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
        </div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Foto</span>
          <div className="h-44 rounded-xl bg-surface-container flex items-center justify-center overflow-hidden">{previa ? <img src={previa} alt="Vista previa" className="w-full h-full object-cover" /> : <span className="text-on-surface-variant">{plato?.tieneFoto ? 'Foto actual: elige otra para cambiarla' : 'Sin foto'}</span>}</div>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} className="font-body-sm" />
        </label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Nombre del plato</span><input name="nombre" required maxLength={120} defaultValue={plato?.nombre} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Descripción</span><textarea name="descripcion" maxLength={500} rows={3} defaultValue={plato?.descripcion ?? ''} className={`${clases.input} h-auto py-space-sm`} /></label>
        <div className="grid grid-cols-2 gap-space-sm">
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Precio (Bs)</span><input name="precio" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" defaultValue={plato?.precio} className={`${clases.input} font-label-lg`} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Cocina (min)</span><input name="minutos" type="number" min={0} max={600} defaultValue={plato?.minutosPreparacion ?? ''} className={clases.input} /></label>
        </div>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Categoría</span>
          <select name="categoria" defaultValue={plato?.categoriaId ?? ''} className={clases.input}><option value="">Sin categoría</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        </label>
        <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Alérgenos</legend>
          <div className="flex flex-wrap gap-space-xs">{ALERGENOS.map(([k, n]) => (
            <button key={k} type="button" aria-pressed={alergenos.includes(k)} onClick={() => setAlergenos((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))} className={`h-10 px-space-sm rounded-full border font-label-md text-label-md ${alergenos.includes(k) ? 'bg-primary-container text-on-primary border-primary-container' : 'border-outline-variant text-on-surface-variant'}`}>{n}</button>
          ))}</div>
        </fieldset>
        <label className="flex items-center gap-space-sm"><input type="checkbox" name="disponible" defaultChecked={plato?.disponible ?? true} className="w-5 h-5" /><span>Disponible hoy</span></label>
        {error && <p role="alert" className="text-error">{error}</p>}
        <div className="flex gap-space-sm mt-auto sticky bottom-0 bg-surface pt-space-sm">
          <button disabled={trabajando} className={clases.primario}>{trabajando ? 'Guardando…' : 'Guardar'}</button>
          {plato && <button type="button" onClick={borrar} className="h-14 px-space-md rounded-lg border border-error text-error font-semibold">Borrar</button>}
        </div>
      </form>
    </div>
  );
}
