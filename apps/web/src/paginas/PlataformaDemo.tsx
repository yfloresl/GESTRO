import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensajeDeError } from '../lib/sesion';

const ETIQUETA: Record<string, string> = { owner: 'administrador', cajero: 'caja', mesero: 'mesero', cocina: 'cocina', almacen: 'almacén', cobranzas: 'cobranzas', contador: 'contador' };
interface Estado { cargada: boolean; sucursal?: { id: string; nombre: string; slug: string }; ultimoReinicio?: string | null; cuentas: { usuario: string; rol: string; vinculada: boolean }[] }

/** Consola de plataforma: la sucursal de muestra de las cuentas Prueba_Kyros (se pre-vinculan por su sub fijo de Kyros ID). */
export function PlataformaDemo() {
  const qc = useQueryClient(); const [error, setError] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false);
  const q = useQuery({ queryKey: ['plataforma-demo'], queryFn: () => api.get<Estado>('/plataforma/demo') });
  const accion = async (f: () => Promise<unknown>, ok: string) => { setError(null); setMsg(null); setOcupado(true); try { await f(); setMsg(ok); await qc.invalidateQueries({ queryKey: ['plataforma-demo'] }); } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(false); } };
  const e = q.data;
  if (!e) return <p role="status">Cargando…</p>;
  return (
    <section className="flex flex-col gap-space-md">
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}{msg && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm">Restaurante de muestra (cuentas Prueba_Kyros)</h2>
        <p className="text-on-surface-variant">Una sola sucursal («Casa Andina») con menú, recetas, inventario, 60 días de ventas, contabilidad, una promoción y un evento. Es de solo lectura: quien entra con las cuentas Prueba_Kyros puede mirar todo y, si es el administrador, restablecer sus datos de muestra (máximo una vez cada 5 minutos). Mientras no esté cargada, esas cuentas no pueden entrar.</p>
        <p>Estado: <strong>{e.cargada ? `cargada (${e.sucursal?.nombre})` : 'no cargada'}</strong>{e.ultimoReinicio ? ` · último reinicio ${new Date(e.ultimoReinicio).toLocaleString('es-BO')}` : ''}</p>
        <ul className="flex flex-col gap-1">{e.cuentas.map((c) => <li key={c.usuario} className="flex justify-between rounded-lg bg-surface-container p-space-sm"><span>{c.usuario} <span className="text-on-surface-variant">({ETIQUETA[c.rol] ?? c.rol})</span></span><span className={c.vinculada ? 'text-tertiary font-semibold' : 'text-on-surface-variant'}>{c.vinculada ? 'vinculada' : 'sin vincular'}</span></li>)}</ul>
        <div className="flex flex-wrap gap-space-xs">
          {!e.cargada && <button type="button" disabled={ocupado} onClick={() => accion(() => api.post('/plataforma/demo', {}), 'Restaurante de muestra cargado: las cuentas Prueba_Kyros ya pueden entrar.')} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-60">{ocupado ? 'Cargando… (unos segundos)' : 'Cargar restaurante de muestra'}</button>}
          {e.cargada && <button type="button" disabled={ocupado} onClick={() => { if (confirm('Se quitará el restaurante de muestra con todos sus datos y las cuentas Prueba_Kyros dejarán de entrar. ¿Continuar?')) void accion(() => api.del('/plataforma/demo'), 'Restaurante de muestra quitado.'); }} className="h-12 px-space-md rounded-lg border border-error text-error font-semibold disabled:opacity-60">Quitar restaurante de muestra</button>}
        </div>
      </div>
    </section>
  );
}
