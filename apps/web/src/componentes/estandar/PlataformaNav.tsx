import { NavLink } from 'react-router-dom';
import { PLATAFORMA_NOMBRE, PLATAFORMA_SECCIONES } from '../../lib/kyros-estandar';

/** S-04: navegación ÚNICA de la consola «Plataforma»: Clientes, Planes, Facturación, Integraciones, Auditoría, Demostración. */
export function PlataformaNav() {
  return (
    <nav aria-label={PLATAFORMA_NOMBRE} className="flex gap-space-xs overflow-x-auto">
      {PLATAFORMA_SECCIONES.map((s) => (
        <NavLink key={s.id} to={s.ruta} className={({ isActive }) => `h-12 px-space-md rounded-lg font-semibold whitespace-nowrap flex items-center ${isActive ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{s.etiqueta}</NavLink>
      ))}
    </nav>
  );
}
