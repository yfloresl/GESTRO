import { NavLink } from 'react-router-dom';
import { MenuPlataforma } from '../../lib/kyros-estandar-ui';
/** S-04: navegación ÚNICA de la consola «Plataforma» (menú del estándar: Clientes, Planes, Facturación, Integraciones, Auditoría, Demostración). */
export function PlataformaNav() {
  return (
    <div className="overflow-x-auto">
      <MenuPlataforma renderEnlace={(s) => (
        <NavLink to={s.ruta} className={({ isActive }) => `h-12 px-space-md rounded-lg font-semibold whitespace-nowrap flex items-center ${isActive ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{s.etiqueta}</NavLink>
      )} />
    </div>
  );
}
