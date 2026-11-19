import { useNavigate } from 'react-router-dom';
import { SinPermiso as SinPermisoComun } from '../../lib/kyros-estandar-ui';
import { SIN_PERMISO } from '../../lib/kyros-local';
/** S-10: pantalla ÚNICA del estándar «No tienes permiso para ver esto». `aQuien`: quien administra el acceso en GESTRO. */
export function SinPermiso({ aQuien = 'quien administra tu restaurante', volverA = '/app' }: { aQuien?: string; volverA?: string }) {
  const ir = useNavigate();
  return <div data-testid="sin-permiso"><SinPermisoComun aQuien={SIN_PERMISO.ayuda(aQuien)} onVolver={() => ir(volverA)} /></div>;
}
