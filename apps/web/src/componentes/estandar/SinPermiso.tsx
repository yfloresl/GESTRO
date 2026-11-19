import { Link } from 'react-router-dom';
import { SIN_PERMISO } from '../../lib/kyros-estandar';

/** S-10: pantalla ÚNICA «No tienes permiso para ver esto» (igual en los 7 sistemas). `aQuien`: quien administra el acceso en GESTRO. */
export function SinPermiso({ aQuien = 'quien administra tu restaurante', volverA = '/app' }: { aQuien?: string; volverA?: string }) {
  return (
    <div role="alert" data-testid="sin-permiso" className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-xl flex flex-col items-center text-center gap-space-sm">
      <span className="material-symbols-outlined text-[40px] text-primary" aria-hidden="true">lock</span>
      <h1 className="font-headline-sm text-headline-sm">{SIN_PERMISO.TITULO}</h1>
      <p className="text-on-surface-variant max-w-md">{SIN_PERMISO.ayuda(aQuien)}</p>
      <Link to={volverA} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center">{SIN_PERMISO.BOTON_VOLVER}</Link>
    </div>
  );
}
