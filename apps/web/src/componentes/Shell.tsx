import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Cargando, Marca } from './Marca';
import { api, ETIQUETA_ROL, useSesion } from '../lib/sesion';
import { cerrarKyrosId } from '../lib/kyrosid';
import { useAvisos } from '../lib/avisos';
import { Link } from 'react-router-dom';

/** Navegación del diseño (5.1). Los módulos de fases siguientes abren un estado vacío hasta construirse. */
type Item = { ruta: string; icono: string; texto: string; roles?: string[]; externa?: string };
const SALON = ['owner', 'admin', 'mesero', 'cajero', 'area_manager'];
export const GRUPOS: { titulo: string; items: Item[] }[] = [
  { titulo: 'Principal', items: [
    { ruta: 'panel', icono: 'analytics', texto: 'Panel del Dueño' },
    { ruta: 'menu', icono: 'menu_book', texto: 'Menú & Fotos', roles: ['owner', 'admin', 'cocina'] },
    { ruta: 'recetas', icono: 'calculate', texto: 'Recetas & Costeo', roles: ['owner', 'admin', 'cocina', 'almacen', 'contador'] },
    { ruta: 'plan-del-dia', icono: 'event_note', texto: 'Plan del día', roles: ['owner', 'admin', 'cocina', 'almacen'] },
    { ruta: 'inventario', icono: 'inventory_2', texto: 'Inventario & Almacenes', roles: ['owner', 'admin', 'almacen', 'cocina', 'contador'] },
  ] },
  { titulo: 'Operaciones', items: [
    { ruta: 'pedidos', icono: 'receipt_long', texto: 'Pedidos', roles: SALON },
    { ruta: 'cocina', icono: 'skillet', texto: 'Cocina (KDS)', roles: ['owner', 'admin', 'cocina'], externa: '/cocina' },
    { ruta: 'caja', icono: 'point_of_sale', texto: 'Caja', roles: ['owner', 'admin', 'cajero'] },
    { ruta: 'salon', icono: 'qr_code_2', texto: 'Mesas & Salón (QR)', roles: SALON },
    { ruta: 'compras', icono: 'local_shipping', texto: 'Compras & Proveedores', roles: ['owner', 'admin', 'almacen', 'contador'] },
    { ruta: 'eventos', icono: 'celebration', texto: 'Eventos & Catering', roles: ['owner', 'admin', 'cocina', 'almacen', 'cajero', 'contador', 'area_manager'] },
    { ruta: 'reservas', icono: 'event_seat', texto: 'Reservas', roles: SALON },
    { ruta: 'personal', icono: 'badge', texto: 'Personal', roles: ['owner', 'admin'] },
    { ruta: 'turnos', icono: 'schedule', texto: 'Turnos & Asistencia', roles: ['owner', 'admin', 'area_manager', 'contador', 'mesero', 'cajero', 'cocina', 'almacen', 'cobranzas'] },
  ] },
  { titulo: 'Gestión & Finanzas', items: [
    { ruta: 'suscripcion', icono: 'workspace_premium', texto: 'Suscripción', roles: ['owner', 'admin'] },
    { ruta: 'plataforma', icono: 'admin_panel_settings', texto: 'Plataforma Kyros', roles: [] },
    { ruta: 'promociones', icono: 'sell', texto: 'Promociones', roles: ['owner', 'admin', 'contador', 'area_manager', 'cajero'] },
    { ruta: 'cobranzas', icono: 'request_quote', texto: 'Cuentas por cobrar', roles: ['owner', 'admin', 'cobranzas', 'cajero', 'contador'] },
    { ruta: 'contabilidad', icono: 'account_balance_wallet', texto: 'Contabilidad & Libros', roles: ['owner', 'admin', 'contador'] },
    { ruta: 'estadisticas', icono: 'query_stats', texto: 'Estadísticas & BI' },
    { ruta: 'configuracion', icono: 'settings', texto: 'Configuración', roles: ['owner', 'admin'] },
  ] },
];

/** Panel y avisos para todos; cada módulo solo a los roles que lo usan (el servidor vuelve a validar). */
function visible(it: Item, roles: string[], plataforma: boolean) {
  if (it.ruta === 'panel') return true;
  if (it.ruta === 'plataforma') return plataforma;
  // El equipo de plataforma sin sucursal propia solo ve su consola.
  if (plataforma && roles.length === 0) return false;
  const permitidos = it.roles ?? ['owner', 'admin'];
  return roles.some((r) => permitidos.includes(r));
}

const PORTAL_KYROS = 'https://portal.kyros-tech.com/';
const CUENTA_KYROS = 'https://auth.kyros-tech.com/realms/kyros/account';

export function Shell() {
  const { estado, sesion, sucursalId, elegirSucursal, salir } = useSesion();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [rielAbierto, setRielAbierto] = useState(false);
  const cuenta = useRef<HTMLDivElement>(null);
  const { nuevas } = useAvisos();
  const cfg = useQuery({ queryKey: ['kyros-id-config'], queryFn: () => api.kyrosIdConfig(), staleTime: Infinity });
  const activa = sesion?.sucursales.find((s) => s.id === sucursalId);
  const admin = !!activa?.roles.some((r) => r === 'owner' || r === 'admin');
  const sus = useQuery({ queryKey: ['suscripcion', sucursalId], queryFn: () => api.get<{ estado: string; diasRestantes: number | null; diasDeGracia: number }>('/suscripcion', sucursalId!), enabled: !!sucursalId && admin, staleTime: 60_000 });

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
  const rolesActivos = sucursal?.roles ?? [];
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
                {g.items.filter((it) => visible(it, rolesActivos, sesion.usuario.esPlataforma)).map((it) => (
                  <NavLink key={it.ruta} to={it.externa ?? `/app/${it.ruta}`} onClick={() => setRielAbierto(false)}
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
          {sus.data && sus.data.estado !== 'activa' && (
            <div role="alert" className={`mt-space-md rounded-xl p-space-md flex flex-wrap items-center justify-between gap-space-sm ${sus.data.estado === 'vencida' ? 'bg-error-container text-on-error-container' : 'bg-secondary-fixed text-on-secondary-fixed-variant'}`}>
              <p className="font-body-md font-semibold flex items-center gap-space-xs"><span className="material-symbols-outlined" aria-hidden="true">{sus.data.estado === 'vencida' ? 'lock' : 'schedule'}</span>
                {sus.data.estado === 'vencida' ? 'Tu suscripción venció: el sistema está en modo solo lectura. No se pierde nada.' : sus.data.estado === 'gracia' ? `Tu suscripción venció. Tienes unos días de gracia antes del modo solo lectura.` : `Tu suscripción vence ${sus.data.diasRestantes === 0 ? 'hoy' : `en ${sus.data.diasRestantes} ${sus.data.diasRestantes === 1 ? 'día' : 'días'}`}.`}</p>
              <Link to="/app/suscripcion" className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold flex items-center">Pagar ahora</Link>
            </div>
          )}
          <div className="pt-space-lg"><Outlet /></div>
        </main>
      </div>
    </>
  );
}
