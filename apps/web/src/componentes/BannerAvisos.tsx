import { useState } from 'react';
import { activarPush, desactivarPush, useAvisos, useEstadoPush } from '../lib/avisos';

/** Pide activar los avisos con pantalla bloqueada; en iPhone explica cómo instalar la PWA (requisito de Apple). */
export function BannerAvisos({ siempre = false }: { siempre?: boolean }) {
  const { estado, refrescar } = useEstadoPush();
  const { sonido, alternarSonido } = useAvisos();
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  if (!estado || (estado === 'activo' && !siempre)) return null;
  const accion = async (f: () => Promise<unknown>) => { setError(null); setTrabajando(true); try { await f(); } catch { setError('No pudimos cambiar los avisos. Inténtalo otra vez.'); } finally { setTrabajando(false); refrescar(); } };

  return (
    <section aria-label="Avisos" className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md flex flex-col gap-space-sm">
      <div className="flex items-start gap-space-sm">
        <span className="material-symbols-outlined text-primary mt-0.5" aria-hidden="true">{estado === 'activo' ? 'notifications_active' : 'notifications'}</span>
        <div className="flex-1">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">Avisos de mesa con el celular bloqueado</h2>
          {estado === 'activo' && <p className="font-body-sm text-body-sm text-on-surface-variant">Activados en este dispositivo: te llegará una notificación con sonido y vibración.</p>}
          {estado === 'inactivo' && <p className="font-body-sm text-body-sm text-on-surface-variant">Actívalos para enterarte de los llamados aunque tengas la pantalla apagada.</p>}
          {estado === 'bloqueado' && <p className="font-body-sm text-body-sm text-on-surface-variant">Las notificaciones están bloqueadas. Actívalas desde los ajustes del navegador para este sitio.</p>}
          {estado === 'no-soportado' && <p className="font-body-sm text-body-sm text-on-surface-variant">Este navegador no admite avisos con pantalla bloqueada. Con la app abierta, igual suena y vibra.</p>}
          {estado === 'instalar-ios' && (
            <ol className="font-body-sm text-body-sm text-on-surface-variant list-decimal pl-5 mt-space-xs flex flex-col gap-1">
              <li>Abre esta página en <strong>Safari</strong>.</li>
              <li>Toca <strong>Compartir</strong> (el cuadro con la flecha) y luego <strong>Agregar a pantalla de inicio</strong>.</li>
              <li>Abre GESTRO desde el ícono nuevo y vuelve aquí para activar los avisos.</li>
              <li>El iPhone no deja que una web vibre por sí sola: la vibración y el sonido de la notificación dependen de los ajustes del iPhone.</li>
            </ol>
          )}
        </div>
      </div>
      {error && <p role="alert" className="text-error font-body-sm text-body-sm">{error}</p>}
      <div className="flex flex-wrap gap-space-sm">
        {estado === 'inactivo' && <button type="button" disabled={trabajando} onClick={() => accion(activarPush)} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold">Activar avisos</button>}
        {estado === 'activo' && <button type="button" disabled={trabajando} onClick={() => accion(desactivarPush)} className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold">Desactivar en este dispositivo</button>}
        <button type="button" onClick={alternarSonido} aria-pressed={sonido} className="h-12 px-space-md rounded-lg border border-outline-variant text-on-surface-variant flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{sonido ? 'volume_up' : 'volume_off'}</span>{sonido ? 'Sonido con la app abierta: sí' : 'Sonido con la app abierta: no'}
        </button>
      </div>
    </section>
  );
}
