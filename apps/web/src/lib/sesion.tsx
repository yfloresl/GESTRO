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
  ingresar(s: SesionRespuesta): void;
  salir(): Promise<void>;
}
const SesionCtx = createContext<Ctx | null>(null);

const CLAVE_SUCURSAL = 'gestro.sucursal';
const leer = () => { try { return localStorage.getItem(CLAVE_SUCURSAL); } catch { return null; } };
const guardar = (v: string) => { try { localStorage.setItem(CLAVE_SUCURSAL, v); } catch { /* sin almacenamiento: no pasa nada */ } };

/** El acceso vive solo en memoria; el refresco, en una cookie HttpOnly que el navegador envía solo. */
export function SesionProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [sesion, setSesion] = useState<SesionRespuesta | null>(null);
  const [sucursalId, setSucursalId] = useState<string | null>(null);
  const temporizador = useRef<number>();

  const ingresar = useCallback((s: SesionRespuesta) => {
    api.setToken(s.accessToken);
    setSesion(s);
    setSucursalId((actual) => {
      const previa = actual ?? leer();
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

  const valor = useMemo<Ctx>(() => ({
    estado, sesion, sucursalId, ingresar, salir,
    elegirSucursal: (id) => { guardar(id); setSucursalId(id); },
  }), [estado, sesion, sucursalId, ingresar, salir]);

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
