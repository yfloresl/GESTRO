import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, mensajeDeError, useSesion } from '../lib/sesion';

/** Aviso fijo en la sucursal de muestra (cuentas Prueba_Kyros): solo lectura, y quien administra puede restablecer los datos. */
export function BannerMuestra() {
  const { sesion, sucursalId, soporte, salirSoporte } = useSesion();
  const nav = useNavigate();
  const qc = useQueryClient(); const [ocupado, setOcupado] = useState(false); const [error, setError] = useState<string | null>(null); const [ok, setOk] = useState(false);
  const info = useQuery({ queryKey: ['sucursal-info', sucursalId], queryFn: () => api.get<{ demo?: boolean }>('/sucursal', sucursalId!), enabled: !!sucursalId, staleTime: 5 * 60_000 });
  if (soporte && sucursalId === soporte.id) {
    return (
      <div role="status" className="mt-space-md rounded-xl bg-secondary-fixed text-on-secondary-fixed-variant p-space-md flex flex-wrap items-center justify-between gap-space-sm">
        <p className="font-body-md font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">support_agent</span>Modo soporte en «{soporte.nombre}»: puedes mirar todo, pero no modificar nada. Tu ingreso quedó registrado.</p>
        <button type="button" onClick={() => { salirSoporte(); nav('/app/plataforma'); }} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold">Salir del modo soporte</button>
      </div>
    );
  }
  if (!info.data?.demo) return null;
  const esDueno = !!sesion?.sucursales.find((s) => s.id === sucursalId)?.roles.includes('owner');
  const restablecer = async () => {
    if (!confirm('Se borrarán los datos de muestra y se cargarán de nuevo. ¿Continuar?')) return;
    setError(null); setOk(false); setOcupado(true);
    try { await api.post('/demo/restablecer', undefined, sucursalId!); setOk(true); await qc.invalidateQueries(); } catch (e) { setError(mensajeDeError(e)); } finally { setOcupado(false); }
  };
  return (
    <div role="status" className="mt-space-md rounded-xl bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-md flex flex-wrap items-center justify-between gap-space-sm">
      <p className="font-body-md font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">visibility</span>Estás recorriendo un restaurante de muestra: puedes mirar todo, pero no modificar nada.</p>
      {esDueno && <button type="button" disabled={ocupado} onClick={restablecer} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-60">{ocupado ? 'Restableciendo…' : 'Restablecer mis datos de muestra'}</button>}
      {ok && <p className="w-full font-body-sm">Listo: los datos de muestra volvieron a su estado inicial.</p>}
      {error && <p role="alert" className="w-full font-body-sm text-error">{error}</p>}
    </div>
  );
}
