// Puente con la app Android nativa (Capacitor, `apps/android`). Sin dependencias: usa el `window.Capacitor` que el envoltorio inyecta
// en la página (en un navegador normal todo esto es inerte).
//
// Login nativo: Kyros ID se abre en el NAVEGADOR DEL SISTEMA (Custom Tabs) y NUNCA dentro del WebView (RFC 8252). El retorno es el esquema
// propio `com.kyros.gestro://callback?code=…&state=…`; la app lo recibe (`appUrlOpen`), cierra la pestaña y entrega a `/callback` SOLO
// `code`, `state` y `error`; el canje PKCE ocurre en `completarIngreso`, igual que en la web.
export const REDIRECT_NATIVO = 'com.kyros.gestro://callback';
/** Client público PKCE de Kyros ID para la app (redirect exacto `com.kyros.gestro://callback`). La web usa el de la configuración pública. */
export const CLIENT_NATIVO = 'gestro-mobile';

interface Plugins {
  Browser?: { open(o: { url: string }): Promise<void>; close(): Promise<void> };
  App?: { addListener(e: 'appUrlOpen', cb: (x: { url: string }) => void): Promise<unknown> | unknown; getLaunchUrl(): Promise<{ url?: string } | undefined> };
}
interface CapacitorGlobal { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: Plugins }
const capacitor = (): CapacitorGlobal | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor);

export function esAppNativa(): boolean {
  const c = capacitor();
  return !!c && c.isNativePlatform?.() === true && c.getPlatform?.() === 'android';
}

/** Abre la URL en Custom Tabs. false si no es la app nativa o falta el plugin (el llamador navega normal). */
export async function abrirEnNavegadorDelSistema(url: string): Promise<boolean> {
  const b = capacitor()?.Plugins?.Browser;
  if (!esAppNativa() || !b) return false;
  await b.open({ url });
  return true;
}

/** Del enlace de retorno solo pasan `code`, `state` y `error`. Null si no es el callback nativo. */
export function busquedaDelRetorno(url: string): string | null {
  if (typeof url !== 'string' || !url.startsWith(`${REDIRECT_NATIVO}?`)) return null;
  let params: URLSearchParams;
  try { params = new URLSearchParams(url.slice(REDIRECT_NATIVO.length + 1).split('#')[0]); } catch { return null; }
  const out = new URLSearchParams();
  for (const k of ['code', 'state', 'error']) { const v = params.get(k); if (v && v.length <= 2048) out.set(k, v); }
  return out.toString() === '' ? null : `?${out.toString()}`;
}

let registrado = false;
/** Registra (una vez) la recepción del enlace de retorno. Inerte fuera de la app nativa. */
export function registrarRetornoNativo(): void {
  if (registrado || !esAppNativa()) return;
  const app = capacitor()?.Plugins?.App; if (!app) return;
  registrado = true;
  const manejar = (url: string | undefined) => {
    const q = busquedaDelRetorno(url ?? ''); if (q === null) return;
    void capacitor()?.Plugins?.Browser?.close().catch(() => undefined);
    window.location.replace(`/callback${q}`);
  };
  void app.addListener('appUrlOpen', (e) => manejar(e.url));
  void app.getLaunchUrl().then((r) => manejar(r?.url)).catch(() => undefined);   // arranque en frío: Android pudo matar el proceso durante el login
}
