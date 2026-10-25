import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { api, useSesion } from './sesion';

export interface Solicitud {
  id: string; mesaId: string; mesa: string; tipo: 'atencion' | 'cuenta' | 'servicio' | 'otro'; comentario: string | null;
  estado: 'pendiente' | 'atendida' | 'cancelada'; meseroId: string | null; creada: string; atendida: string | null; escalada: boolean; paraMi?: boolean;
}
export interface AvisoPedido { id: string; mesa?: string | null; ticket?: number | null; paraMi?: boolean; items?: number }
export const ETIQUETA_SOLICITUD: Record<string, string> = { atencion: 'Llamado de mesero', cuenta: 'Pide la cuenta', servicio: 'Pide servicio', otro: 'Solicitud' };

interface Ctx { nuevas: number; ultima: Solicitud | null; descartar(): void; sonido: boolean; alternarSonido(): void }
const AvisosCtx = createContext<Ctx>({ nuevas: 0, ultima: null, descartar() {}, sonido: true, alternarSonido() {} });
export const useAvisos = () => useContext(AvisosCtx);

let audio: AudioContext | null = null;
/** Pitido corto con WebAudio. El navegador exige un gesto previo del usuario: se «despierta» en el primer toque. */
function pitar(urgente: boolean) {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const notas = urgente ? [988, 784, 988] : [880, 1175];
    notas.forEach((f, i) => {
      const o = audio!.createOscillator(); const g = audio!.createGain();
      o.frequency.value = f; o.connect(g); g.connect(audio!.destination);
      const t0 = audio!.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.start(t0); o.stop(t0 + 0.17);
    });
  } catch { /* sin audio: queda la vibración y el aviso en pantalla */ }
}
const despertarAudio = () => { try { audio ??= new AudioContext(); void audio.resume(); } catch { /* nada */ } };

/**
 * Solicitudes de mesa en vivo para el personal: Socket.IO con el token de acceso. Cada alerta suena, vibra
 * (donde el navegador lo permite; iPhone no deja a una web vibrar) y refresca las listas.
 */
export function AvisosProvider({ children }: { children: ReactNode }) {
  const { sesion, sucursalId } = useSesion();
  const qc = useQueryClient();
  const [nuevas, setNuevas] = useState(0);
  const [ultima, setUltima] = useState<Solicitud | null>(null);
  const [sonido, setSonido] = useState(() => { try { return localStorage.getItem('gestro.sonido') !== 'no'; } catch { return true; } });
  const sonidoRef = useRef(sonido); sonidoRef.current = sonido;
  const usuario = sesion?.usuario.id ?? null;

  useEffect(() => { document.addEventListener('pointerdown', despertarAudio, { once: true }); return () => document.removeEventListener('pointerdown', despertarAudio); }, []);

  useEffect(() => {
    if (!usuario) return;
    const socket: Socket = io({ path: '/api/socket.io', auth: (cb) => cb({ token: api.accessToken ?? '' }), transports: ['websocket', 'polling'] });
    const alerta = (urgente: boolean) => (s: Solicitud) => {
      // Un mesero se entera de las suyas; el resto de la sucursal solo ve la lista (y el encargado, las escaladas).
      if (s.paraMi === false && !urgente) { void qc.invalidateQueries({ queryKey: ['solicitudes'] }); return; }
      setNuevas((n) => n + 1); setUltima(s);
      if (sonidoRef.current) pitar(urgente);
      try { navigator.vibrate?.(urgente ? [300, 120, 300, 120, 300] : [220, 100, 220]); } catch { /* sin vibración */ }
      void qc.invalidateQueries({ queryKey: ['solicitudes'] });
    };
    socket.on('solicitud.nueva', alerta(false));
    socket.on('solicitud.escalada', alerta(true));
    socket.on('solicitud.atendida', () => { void qc.invalidateQueries({ queryKey: ['solicitudes'] }); });
    // Pedidos: cocina se refresca sola; el mesero se entera cuando un pedido queda listo o el cliente pide por QR.
    const refrescarPedidos = () => { void qc.invalidateQueries({ queryKey: ['tickets'] }); void qc.invalidateQueries({ queryKey: ['pedidos'] }); void qc.invalidateQueries({ queryKey: ['pedido'] }); };
    socket.on('ticket.nuevo', () => { refrescarPedidos(); if (sonidoRef.current) pitar(false); });
    socket.on('ticket.actualizado', refrescarPedidos);
    socket.on('pedido.cobrado', refrescarPedidos);
    const aviso = (a: AvisoPedido) => { refrescarPedidos(); if (a.paraMi === false) return; setNuevas((n) => n + 1); if (sonidoRef.current) pitar(true); try { navigator.vibrate?.([300, 120, 300]); } catch { /* sin vibración */ } };
    socket.on('pedido.listo', aviso);
    socket.on('pedido.qr', aviso);
    return () => { socket.close(); };
  }, [usuario, sucursalId, qc]);

  useEffect(() => { document.title = nuevas > 0 ? `(${nuevas}) GESTRO` : 'GESTRO'; }, [nuevas]);

  const valor = useMemo<Ctx>(() => ({
    nuevas, ultima, sonido,
    descartar: () => { setNuevas(0); setUltima(null); },
    alternarSonido: () => setSonido((v) => { try { localStorage.setItem('gestro.sonido', v ? 'no' : 'si'); } catch { /* sin almacenamiento */ } return !v; }),
  }), [nuevas, ultima, sonido]);
  return <AvisosCtx.Provider value={valor}>{children}</AvisosCtx.Provider>;
}

/* ---------- Web Push (pantalla bloqueada) ---------- */

export type EstadoPush = 'no-soportado' | 'instalar-ios' | 'bloqueado' | 'inactivo' | 'activo';

const esIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalada = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const aBytes = (b64: string) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const r = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };

export async function estadoPush(): Promise<EstadoPush> {
  // En iPhone, Web Push solo existe con la PWA instalada en la pantalla de inicio (iOS 16.4 o superior).
  if (esIos() && !instalada()) return 'instalar-ios';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'no-soportado';
  if (Notification.permission === 'denied') return 'bloqueado';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'activo' : 'inactivo';
}

export async function activarPush(): Promise<EstadoPush> {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return permiso === 'denied' ? 'bloqueado' : 'inactivo';
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const { clave } = await api.get<{ clave: string }>('/push/clave');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(clave) }));
  await api.post('/push/suscribir', sub.toJSON());
  return 'activo';
}

export async function desactivarPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.del('/push/suscribir', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

export function useEstadoPush() {
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const refrescar = useCallback(() => { estadoPush().then(setEstado).catch(() => setEstado('no-soportado')); }, []);
  useEffect(refrescar, [refrescar]);
  return { estado, refrescar };
}
