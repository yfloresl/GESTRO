import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { clases } from '../componentes/Marca';
import { BannerAvisos } from '../componentes/BannerAvisos';
import { ETIQUETA_SOLICITUD, Solicitud, useAvisos } from '../lib/avisos';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';

interface Area { id: string; nombre: string; encargadoId: string | null }
interface Mesa { id: string; numero: string; asientos: number; areaId: string | null; activa: boolean; meseroId: string | null; urlQr?: string }
interface Persona { id: string; nombre: string; roles: string[]; activo: boolean }

const hace = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'ahora' : `${m} min`; };

/** Mesas & Salón: llamados en vivo, mapa de mesas por área (pantalla 2.1) y configuración para quien administra. */
export function Salon() {
  const { sucursalId, esAdmin } = useRolesActivos();
  const qc = useQueryClient();
  const { descartar } = useAvisos();
  const [areaSel, setAreaSel] = useState<string>('todas');
  const [error, setError] = useState<string | null>(null);
  const [, reloj] = useState(0);
  useEffect(() => { descartar(); const t = setInterval(() => reloj((n) => n + 1), 30_000); return () => clearInterval(t); }, [descartar]);

  const areas = useQuery({ queryKey: ['areas', sucursalId], queryFn: () => api.get<Area[]>('/areas', sucursalId!), enabled: !!sucursalId });
  const mesas = useQuery({ queryKey: ['mesas', sucursalId], queryFn: () => api.get<Mesa[]>('/mesas', sucursalId!), enabled: !!sucursalId });
  // Respaldo por si se corta el tiempo real: se vuelve a pedir cada 30 s.
  const sol = useQuery({ queryKey: ['solicitudes', sucursalId], queryFn: () => api.get<Solicitud[]>('/solicitudes?estado=pendiente', sucursalId!), enabled: !!sucursalId, refetchInterval: 30_000 });
  const atender = useMutation({
    mutationFn: (id: string) => api.post(`/solicitudes/${id}/atender`, undefined, sucursalId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['solicitudes', sucursalId] }), onError: (e) => { setError(mensajeDeError(e)); void qc.invalidateQueries({ queryKey: ['solicitudes', sucursalId] }); },
  });

  const pendientes = sol.data ?? [];
  const porMesa = useMemo(() => { const m = new Map<string, Solicitud[]>(); for (const s of pendientes) m.set(s.mesaId, [...(m.get(s.mesaId) ?? []), s]); return m; }, [pendientes]);
  const visibles = (mesas.data ?? []).filter((m) => m.activa && (areaSel === 'todas' || m.areaId === areaSel));

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Mesas &amp; Salón</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">Llamados de los clientes en tiempo real y mapa de mesas.</p>
      </header>
      <BannerAvisos />
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}

      <section aria-labelledby="llamados" className="flex flex-col gap-space-sm">
        <h2 id="llamados" className="font-headline-sm text-headline-sm flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-error" aria-hidden="true">notifications_active</span>Llamados
          <span className="px-2 rounded-full bg-error text-on-error font-label-md text-label-md" aria-label={`${pendientes.length} pendientes`}>{pendientes.length}</span>
        </h2>
        {sol.isLoading ? <p role="status">Cargando…</p> : pendientes.length === 0 ? (
          <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Sin llamados pendientes. Cuando un cliente avise desde su QR, aparecerá aquí con sonido.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">
            {pendientes.map((s) => (
              <li key={s.id} className={`rounded-xl p-space-md flex flex-col gap-space-sm border-2 ${s.escalada ? 'border-error bg-error-container' : 'border-error-container bg-error-container/50'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-headline-md text-headline-md text-on-error-container">Mesa {s.mesa}</span>
                  <span className="px-2 py-0.5 rounded-full bg-error text-on-error font-label-md text-label-md flex items-center gap-1"><span className="material-symbols-outlined text-[16px]" aria-hidden="true">alarm</span>{hace(s.creada)}</span>
                </div>
                <p className="font-body-md text-body-md font-semibold text-on-error-container">{ETIQUETA_SOLICITUD[s.tipo]}{s.escalada ? ' · sin atender' : ''}</p>
                {s.comentario && <p className="bg-surface-container-lowest rounded-lg p-space-sm text-on-surface">«{s.comentario}»</p>}
                <button type="button" disabled={atender.isPending} onClick={() => atender.mutate(s.id)} className="h-14 rounded-lg bg-error text-on-error font-semibold flex items-center justify-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">check_circle</span>Atendido</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mapa" className="flex flex-col gap-space-sm">
        <h2 id="mapa" className="font-headline-sm text-headline-sm">Mapa de mesas</h2>
        <div className="flex gap-space-sm overflow-x-auto pb-1" role="tablist" aria-label="Áreas">
          {[{ id: 'todas', nombre: 'Todas' }, ...(areas.data ?? [])].map((a) => (
            <button key={a.id} role="tab" aria-selected={areaSel === a.id} onClick={() => setAreaSel(a.id)} className={`h-12 px-space-md rounded-xl whitespace-nowrap font-body-md font-semibold ${areaSel === a.id ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{a.nombre}</button>
          ))}
        </div>
        {mesas.isLoading ? <p role="status">Cargando mesas…</p> : visibles.length === 0 ? (
          <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">{esAdmin ? 'Aún no hay mesas. Agrégalas abajo, en «Configurar salón».' : 'Todavía no hay mesas cargadas.'}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-space-sm">
            {visibles.map((m) => {
              const abiertas = porMesa.get(m.id) ?? [];
              const llamado = abiertas.find((s) => s.tipo !== 'cuenta'); const cuenta = abiertas.find((s) => s.tipo === 'cuenta');
              const fondo = llamado ? 'bg-error-container border-error' : cuenta ? 'bg-secondary-fixed border-secondary-container' : 'bg-surface-container-lowest border-outline-variant';
              const cuadro = llamado ? 'bg-error text-on-error' : cuenta ? 'bg-secondary-container text-on-secondary-container' : 'bg-primary-container text-on-primary';
              return (
                <li key={m.id} className={`rounded-xl border-2 p-space-sm flex flex-col gap-space-xs ${fondo}`}>
                  <div className="flex items-center gap-space-sm">
                    <span className={`w-12 h-12 rounded-lg flex items-center justify-center font-label-lg text-label-lg ${cuadro}`}>{m.numero.padStart(2, '0')}</span>
                    <div className="min-w-0"><p className="font-body-md font-semibold truncate">Mesa {m.numero}</p><p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1"><span className="material-symbols-outlined text-[16px]" aria-hidden="true">group</span>{m.asientos} pers</p></div>
                  </div>
                  <p className="font-label-sm text-label-sm uppercase font-semibold">{llamado ? `Llamado · ${hace(llamado.creada)}` : cuenta ? `Cuenta · ${hace(cuenta.creada)}` : 'Sin llamados'}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {esAdmin && <Configurar areas={areas.data ?? []} mesas={mesas.data ?? []} refrescar={() => { void qc.invalidateQueries({ queryKey: ['areas', sucursalId] }); void qc.invalidateQueries({ queryKey: ['mesas', sucursalId] }); }} />}
    </div>
  );
}

function Configurar({ areas, mesas, refrescar }: { areas: Area[]; mesas: Mesa[]; refrescar(): void }) {
  const { sucursalId } = useRolesActivos();
  const [error, setError] = useState<string | null>(null);
  const [verQr, setVerQr] = useState(false);
  const personal = useQuery({ queryKey: ['personal', sucursalId], queryFn: () => api.get<Persona[]>('/personal', sucursalId!), enabled: !!sucursalId });
  const meseros = (personal.data ?? []).filter((p) => p.activo && p.roles.some((r) => r === 'mesero' || r === 'area_manager'));
  const encargados = (personal.data ?? []).filter((p) => p.activo);
  const accion = async (f: () => Promise<unknown>) => { setError(null); try { await f(); refrescar(); } catch (e) { setError(mensajeDeError(e)); } };

  const nuevaArea = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; void accion(async () => { await api.post('/areas', { nombre: String(f.get('nombre')).trim(), encargadoId: String(f.get('encargado')) || null }, sucursalId!); form.reset(); }); };
  const nuevaMesa = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; void accion(async () => { await api.post('/mesas', { numero: String(f.get('numero')).trim(), asientos: Number(f.get('asientos')), areaId: String(f.get('area')) || null }, sucursalId!); form.reset(); }); };

  return (
    <details className="bg-surface-container-low rounded-xl p-space-md">
      <summary className="font-headline-sm text-headline-sm cursor-pointer min-h-12 flex items-center">Configurar salón</summary>
      <div className="flex flex-col gap-space-lg mt-space-md">
        {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
        <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
          <form onSubmit={nuevaArea} className="bg-surface-container-lowest rounded-xl border border-outline-variant p-space-md flex flex-col gap-space-sm">
            <h3 className="font-body-lg font-semibold">Nueva área</h3>
            <input name="nombre" required placeholder="Salón principal, Terraza…" aria-label="Nombre del área" className={clases.input} />
            <select name="encargado" aria-label="Encargado del área" className={clases.input}><option value="">Sin encargado</option>{encargados.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
            <button className={clases.secundario}>Agregar área</button>
          </form>
          <form onSubmit={nuevaMesa} className="bg-surface-container-lowest rounded-xl border border-outline-variant p-space-md flex flex-col gap-space-sm">
            <h3 className="font-body-lg font-semibold">Nueva mesa</h3>
            <div className="grid grid-cols-2 gap-space-sm"><input name="numero" required placeholder="Número" aria-label="Número de mesa" className={clases.input} /><input name="asientos" required type="number" min={1} max={50} defaultValue={4} aria-label="Asientos" className={clases.input} /></div>
            <select name="area" aria-label="Área de la mesa" className={clases.input}><option value="">Sin área</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select>
            <button className={clases.secundario}>Agregar mesa</button>
          </form>
        </div>

        <div className="overflow-x-auto"><table className="min-w-[40rem] w-full text-body-sm">
          <caption className="sr-only">Mesas y mesero asignado</caption>
          <thead><tr className="text-left text-on-surface-variant font-label-sm uppercase"><th className="p-2">Mesa</th><th className="p-2">Área</th><th className="p-2">Mesero asignado</th><th className="p-2">QR</th></tr></thead>
          <tbody>{mesas.map((m) => (
            <tr key={m.id} className="border-t border-outline-variant">
              <td className="p-2 font-semibold">Mesa {m.numero} <span className="font-normal text-on-surface-variant">· {m.asientos} pers</span></td>
              <td className="p-2">{areas.find((a) => a.id === m.areaId)?.nombre ?? '—'}</td>
              <td className="p-2"><select aria-label={`Mesero de la mesa ${m.numero}`} value={m.meseroId ?? ''} onChange={(e) => e.target.value && accion(() => api.put('/asignaciones', { mesaId: m.id, meseroId: e.target.value }, sucursalId!))} className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm"><option value="">Sin asignar</option>{meseros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></td>
              <td className="p-2"><button type="button" onClick={() => confirm(`Regenerar el QR de la mesa ${m.numero} invalida el anterior (el impreso dejará de servir). ¿Continuar?`) && accion(() => api.post(`/mesas/${m.id}/qr/regenerar`, undefined, sucursalId!))} className="h-12 px-space-sm rounded-lg border border-outline-variant text-primary">Regenerar</button></td>
            </tr>))}</tbody>
        </table></div>
        {mesas.length > 0 && <button type="button" onClick={() => setVerQr(true)} className={`${clases.primario} sm:w-auto sm:px-space-lg self-start`}><span className="material-symbols-outlined" aria-hidden="true">print</span>Imprimir los QR de las mesas</button>}
      </div>
      {verQr && <HojaQr mesas={mesas} cerrar={() => setVerQr(false)} />}
    </details>
  );
}

/** Hoja imprimible con el QR de cada mesa (el QR apunta a /m/<token>, que abre el menú y los botones de llamado). */
function HojaQr({ mesas, cerrar }: { mesas: Mesa[]; cerrar(): void }) {
  const [imgs, setImgs] = useState<Record<string, string>>({});
  useEffect(() => { (async () => { const r: Record<string, string> = {}; for (const m of mesas) if (m.urlQr) r[m.id] = await QRCode.toDataURL(m.urlQr, { margin: 1, width: 360, errorCorrectionLevel: 'M' }); setImgs(r); })(); }, [mesas]);
  return (
    <div role="dialog" aria-modal="true" aria-label="QR de las mesas" className="fixed inset-0 z-[70] bg-surface overflow-auto p-space-md print:static print:p-0">
      <div className="flex gap-space-sm mb-space-md print:hidden">
        <button type="button" onClick={() => window.print()} className={`${clases.primario} sm:w-auto sm:px-space-lg`}>Imprimir</button>
        <button type="button" onClick={cerrar} className={`${clases.secundario} sm:w-auto sm:px-space-lg`}>Cerrar</button>
      </div>
      <ul className="grid grid-cols-2 gap-space-md md:grid-cols-3 print:grid-cols-2">
        {mesas.filter((m) => m.activa).map((m) => (
          <li key={m.id} className="border-2 border-primary rounded-xl p-space-md flex flex-col items-center gap-space-xs break-inside-avoid text-center">
            <p className="font-headline-md text-headline-md text-primary">Mesa {m.numero}</p>
            {imgs[m.id] ? <img src={imgs[m.id]} alt={`QR de la mesa ${m.numero}`} className="w-48 h-48" /> : <div className="w-48 h-48 bg-surface-container" />}
            <p className="font-body-sm text-body-sm">Escanea para ver el menú y llamar al mesero</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
