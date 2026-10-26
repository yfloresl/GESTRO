import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { SesionRespuesta } from '@gestro/contracts';
import { GestroClient } from '@gestro/sdk';

export const api = new GestroClient('/api/v1');

type Estado = 'cargando' | 'anonimo' | 'activa';
interface Ctx {
  estado: Estado;
  sesion: SesionRespuesta | null;
  sucursalId: string | null;
  elegirSucursal(id: string): void;
  /** Modo soporte (equipo de plataforma): una sucursal ajena a la que se entra para mirar, sin escribir. */
  soporte: { id: string; nombre: string } | null;
  entrarSoporte(id: string, nombre: string): void;
  salirSoporte(): void;
  ingresar(s: SesionRespuesta): void;
  salir(): Promise<void>;
}
const SesionCtx = createContext<Ctx | null>(null);

const CLAVE_SUCURSAL = 'gestro.sucursal';
const CLAVE_SOPORTE = 'gestro.soporte';
const leerSoporte = (): { id: string; nombre: string } | null => { try { const v = JSON.parse(sessionStorage.getItem(CLAVE_SOPORTE) ?? 'null'); return v && typeof v.id === 'string' && typeof v.nombre === 'string' ? v : null; } catch { return null; } };
const leer = () => { try { return localStorage.getItem(CLAVE_SUCURSAL); } catch { return null; } };
const guardar = (v: string) => { try { localStorage.setItem(CLAVE_SUCURSAL, v); } catch { /* sin almacenamiento: no pasa nada */ } };

/** El acceso vive solo en memoria; el refresco, en una cookie HttpOnly que el navegador envía solo. */
export function SesionProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [sesion, setSesion] = useState<SesionRespuesta | null>(null);
  const [sucursalId, setSucursalId] = useState<string | null>(null);
  const [soporte, setSoporte] = useState<{ id: string; nombre: string } | null>(leerSoporte);
  const temporizador = useRef<number>();

  const ingresar = useCallback((s: SesionRespuesta) => {
    api.setToken(s.accessToken);
    setSesion(s);
    setSucursalId((actual) => {
      const previa = actual ?? leer();
      const sop = s.usuario.esPlataforma ? leerSoporte() : null;
      if (sop && (previa === sop.id || s.sucursales.length === 0)) return sop.id;
      return s.sucursales.find((x) => x.id === previa)?.id ?? s.sucursales[0]?.id ?? null;
    });
    setEstado('activa');
    window.clearTimeout(temporizador.current);
    // Se renueva antes de que venza el acceso de 15 minutos.
    temporizador.current = window.setTimeout(() => { api.refrescar().then(ingresar).catch(() => { api.setToken(null); setSesion(null); setEstado('anonimo'); }); }, 13 * 60_000);
  }, []);

  useEffect(() => {
    api.refrescar().then(ingresar).catch(() => setEstado('anonimo'));
    return () => window.clearTimeout(temporizador.current);
  }, [ingresar]);

  const salir = useCallback(async () => {
    window.clearTimeout(temporizador.current);
    await api.salir().catch(() => undefined);
    api.setToken(null); setSesion(null); setEstado('anonimo');
  }, []);

  // En modo soporte, la sucursal ajena se suma a la lista como si el equipo de plataforma fuera su dueño (el servidor igual le impide escribir).
  const sesionEfectiva = useMemo<SesionRespuesta | null>(() => {
    if (!sesion) return null;
    if (!soporte || !sesion.usuario.esPlataforma || sesion.sucursales.some((s) => s.id === soporte.id)) return sesion;
    return { ...sesion, sucursales: [...sesion.sucursales, { id: soporte.id, nombre: soporte.nombre, roles: ['owner'] }] };
  }, [sesion, soporte]);

  const valor = useMemo<Ctx>(() => ({
    estado, sesion: sesionEfectiva, sucursalId, ingresar, salir, soporte: sesionEfectiva && soporte && sesionEfectiva.sucursales.some((s) => s.id === soporte.id) && !sesion?.sucursales.some((s) => s.id === soporte.id) ? soporte : null,
    entrarSoporte: (id, nombre) => { const v = { id, nombre }; try { sessionStorage.setItem(CLAVE_SOPORTE, JSON.stringify(v)); } catch { /* sin almacenamiento */ } setSoporte(v); setSucursalId(id); },
    salirSoporte: () => { try { sessionStorage.removeItem(CLAVE_SOPORTE); } catch { /* sin almacenamiento */ } setSoporte(null); setSucursalId(sesion?.sucursales[0]?.id ?? null); },
    // Solo se acepta una sucursal de la propia sesión (o la de soporte): un valor inválido no deja la pantalla sin sucursal.
    elegirSucursal: (id) => { if (!sesionEfectiva?.sucursales.some((s) => s.id === id)) return; guardar(id); setSucursalId(id); },
  }), [estado, sesion, sesionEfectiva, soporte, sucursalId, ingresar, salir]);

  return <SesionCtx.Provider value={valor}>{children}</SesionCtx.Provider>;
}

export function useSesion(): Ctx {
  const c = useContext(SesionCtx);
  if (!c) throw new Error('useSesion fuera de SesionProvider');
  return c;
}

export const ETIQUETA_ROL: Record<string, string> = {
  owner: 'Dueño', admin: 'Administrador', cobranzas: 'Encargado de cobranzas', cajero: 'Cajero', mesero: 'Mesero',
  area_manager: 'Encargado de área', cocina: 'Jefe de cocina', almacen: 'Almacén', contador: 'Contador',
};

/** Roles de la persona en la sucursal activa y atajos de permiso para la interfaz (el servidor siempre vuelve a validar). */
export function useRolesActivos() {
  const { sesion, sucursalId } = useSesion();
  const roles = sesion?.sucursales.find((s) => s.id === sucursalId)?.roles ?? [];
  return { roles, sucursalId, esAdmin: roles.includes('owner') || roles.includes('admin'), esPlataforma: !!sesion?.usuario.esPlataforma };
}

export const mensajeDeError = (e: unknown, defecto = 'No pudimos completar la acción.') => (e as { cuerpo?: { message?: string } })?.cuerpo?.message ?? defecto;
