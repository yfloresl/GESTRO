import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Cargando, Marca } from './Marca';
import { api, ETIQUETA_ROL, useSesion } from '../lib/sesion';
import { cerrarKyrosId } from '../lib/kyrosid';
import { useAvisos } from '../lib/avisos';

/** Navegación del diseño (5.1). Los módulos de fases siguientes abren un estado vacío hasta construirse. */
export const GRUPOS: { titulo: string; items: { ruta: string; icono: string; texto: string }[] }[] = [
  { titulo: 'Principal', items: [
    { ruta: 'panel', icono: 'analytics', texto: 'Panel del Dueño' },
    { ruta: 'menu', icono: 'menu_book', texto: 'Menú & Fotos' },
    { ruta: 'recetas', icono: 'calculate', texto: 'Recetas & Costeo' },
    { ruta: 'inventario', icono: 'inventory_2', texto: 'Inventario & Almacenes' },
  ] },
  { titulo: 'Operaciones', items: [
    { ruta: 'compras', icono: 'local_shipping', texto: 'Compras & Proveedores' },
    { ruta: 'salon', icono: 'qr_code_2', texto: 'Mesas & Salón (QR)' },
    { ruta: 'reservas', icono: 'event_seat', texto: 'Reservas & Eventos' },
    { ruta: 'personal', icono: 'badge', texto: 'Personal & Turnos' },
  ] },
  { titulo: 'Gestión & Finanzas', items: [
    { ruta: 'promociones', icono: 'sell', texto: 'Promociones' },
    { ruta: 'contabilidad', icono: 'account_balance_wallet', texto: 'Contabilidad & Libros' },
    { ruta: 'estadisticas', icono: 'query_stats', texto: 'Estadísticas & BI' },
    { ruta: 'configuracion', icono: 'settings', texto: 'Configuración' },
  ] },
];

const PORTAL_KYROS = 'https://portal.kyros-tech.com/';
const CUENTA_KYROS = 'https://auth.kyros-tech.com/realms/kyros/account';

export function Shell() {
  const { estado, sesion, sucursalId, elegirSucursal, salir } = useSesion();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [rielAbierto, setRielAbierto] = useState(false);
  const cuenta = useRef<HTMLDivElement>(null);
  const { nuevas } = useAvisos();
  const cfg = useQuery({ queryKey: ['kyros-id-config'], queryFn: () => api.kyrosIdConfig(), staleTime: Infinity });

  useEffect(() => {
    const cerrar = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !cuenta.current?.contains(e.target as Node)) setMenuAbierto(false);
    };
    document.addEventListener('mousedown', cerrar); document.addEventListener('keydown', cerrar);
    return () => { document.removeEventListener('mousedown', cerrar); document.removeEventListener('keydown', cerrar); };
  }, []);

  if (estado === 'cargando') return <Cargando />;
  if (estado === 'anonimo' || !sesion) return <Navigate to="/" replace />;

  const sucursal = sesion.sucursales.find((s) => s.id === sucursalId) ?? null;
  const rol = sucursal ? sucursal.roles.map((r) => ETIQUETA_ROL[r] ?? r).join(' / ') : sesion.usuario.esPlataforma ? 'Plataforma Kyros-Tech' : 'Sin sucursal';

  const cerrar = async () => { await salir(); if (cfg.data) cerrarKyrosId(cfg.data); };

  return (
    <>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-surface focus:p-space-sm focus:rounded-lg">Saltar al contenido</a>
      {rielAbierto && <div className="fixed inset-0 bg-inverse-surface/40 z-40 lg:hidden" onClick={() => setRielAbierto(false)} aria-hidden="true" />}
      <aside className={`fixed left-0 top-0 h-full w-72 bg-surface-container-low shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-50 flex flex-col justify-between overflow-y-auto transition-transform lg:translate-x-0 ${rielAbierto ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col">
          <div className="h-16 px-space-md flex items-center"><Marca /></div>
          <div className="px-space-md py-space-xs">
            <div className="p-space-sm rounded-lg bg-surface-container-high/60 flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant font-medium truncate">{sucursal ? sucursal.nombre.toUpperCase() : 'SUCURSAL ACTIVA'}</span>
              <span className="material-symbols-outlined text-on-surface-variant text-[18px]" aria-hidden="true">store</span>
            </div>
          </div>
          <nav aria-label="Principal" className="flex flex-col px-space-sm mt-space-xs gap-space-xs">
            {GRUPOS.map((g, i) => (
              <div key={g.titulo} className="flex flex-col gap-space-xs">
                <div className={`px-space-sm ${i ? 'pt-space-md' : 'pt-space-sm'} pb-space-xs font-label-sm text-label-sm uppercase text-on-surface-variant font-bold tracking-wider`}>{g.titulo}</div>
                {g.items.map((it) => (
                  <NavLink key={it.ruta} to={`/app/${it.ruta}`} onClick={() => setRielAbierto(false)}
                    className={({ isActive }) => `h-12 flex items-center gap-space-sm px-space-sm rounded-lg transition-colors ${isActive ? 'bg-primary-container text-on-primary font-semibold shadow-sm' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`}>
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{it.icono}</span>
                    <span className="font-body-md text-body-md flex-1">{it.texto}</span>
                    {it.ruta === 'salon' && nuevas > 0 && <span className="min-w-6 h-6 px-1.5 rounded-full bg-error text-on-error font-label-md text-label-md flex items-center justify-center" aria-label={`${nuevas} llamados nuevos`}>{nuevas}</span>}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="fixed top-0 left-0 lg:left-72 right-0 h-16 bg-surface/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-30 flex items-center justify-between px-space-md lg:px-space-lg">
          <div className="flex items-center gap-space-md">
            <button type="button" className="lg:hidden w-12 h-12 flex items-center justify-center rounded-lg" aria-label="Abrir menú" aria-expanded={rielAbierto} onClick={() => setRielAbierto(true)}>
              <span className="material-symbols-outlined" aria-hidden="true">menu</span>
            </button>
            {sesion.sucursales.length > 0 && (
              <div className="relative flex items-center">
                <label className="sr-only" htmlFor="sucursal-select">Seleccionar sucursal</label>
                <select id="sucursal-select" value={sucursalId ?? ''} onChange={(e) => elegirSucursal(e.target.value)}
                  className="h-12 pl-space-md pr-10 bg-surface-container-low text-on-surface font-body-md text-body-md rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary shadow-sm max-w-[14rem] truncate">
                  {sesion.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
                <span className="material-symbols-outlined text-on-surface-variant absolute right-3 pointer-events-none text-[20px]" aria-hidden="true">expand_more</span>
              </div>
            )}
          </div>
          <div ref={cuenta} className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menuAbierto} onClick={() => setMenuAbierto((v) => !v)} className="flex items-center gap-space-md pl-space-md min-h-12">
              <span className="hidden sm:flex flex-col text-right">
                <span className="font-body-md text-body-md font-semibold text-on-surface leading-tight">{sesion.usuario.nombre}</span>
                <span className="font-body-sm text-body-sm text-on-surface-variant leading-tight">{rol}</span>
              </span>
              <span className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-on-primary font-label-md text-label-md" aria-hidden="true">
                {sesion.usuario.nombre.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
              </span>
            </button>
            {menuAbierto && (
              <div role="menu" className="absolute right-0 top-14 w-64 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_4px_6px_-1px_rgba(0,0,0,0.08)] p-space-xs flex flex-col">
                <a role="menuitem" href={CUENTA_KYROS} target="_blank" rel="noopener noreferrer" className="h-12 px-space-sm rounded-lg flex items-center gap-space-sm hover:bg-surface-container"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">shield_person</span>Seguridad de mi cuenta</a>
                <a role="menuitem" href={PORTAL_KYROS} target="_blank" rel="noopener noreferrer" className="h-12 px-space-sm rounded-lg flex items-center gap-space-sm hover:bg-surface-container"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">apps</span>Portal Kyros</a>
                <button role="menuitem" type="button" onClick={cerrar} className="h-12 px-space-sm rounded-lg flex items-center gap-space-sm hover:bg-surface-container text-left"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">logout</span>Cerrar sesión</button>
                <p className="px-space-sm pb-space-xs pt-space-xs font-body-sm text-body-sm text-on-surface-variant">Cerrar sesión cierra tu cuenta Kyros en todos los sistemas.</p>
              </div>
            )}
          </div>
        </header>
        <main id="contenido" className="relative pt-16 w-full min-h-screen bg-background px-space-md lg:px-space-lg py-space-lg">
          <div className="pt-space-lg"><Outlet /></div>
        </main>
      </div>
    </>
  );
}
