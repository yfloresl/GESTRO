import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cargando, clases, Marca, TarjetaCentrada } from '../componentes/Marca';
import { completarIngreso, iniciarIngreso } from '../lib/kyrosid';
import { api, useSesion } from '../lib/sesion';

/** Texto para quien no pudo entrar. Antes un rechazo 401 mostraba «HTTP 401» (GST-R01): no dice qué pasó ni qué hacer. */
export function mensajeDeIngreso(estado: number | undefined, mensaje: string | undefined): string {
  if (estado === 403) return 'Tu cuenta está desactivada. Habla con el administrador de tu restaurante.';
  if (estado === 503) return 'Kyros ID no responde. Inténtalo en un momento.';
  if (estado === 401) return 'Esta cuenta no puede entrar a GESTRO. Si es la primera vez, vuelve al inicio y elige «Crear mi cuenta» (o pide una invitación al administrador de tu restaurante); si es una cuenta de prueba, usa una cuenta con acceso.';
  if (estado === 429) return 'Hiciste demasiados intentos. Espera un minuto y vuelve a intentarlo.';
  return mensaje && !/^HTTP \d+$/.test(mensaje) ? mensaje : 'No pudimos completar el ingreso. Vuelve a intentarlo.';
}

/** Vuelta de Kyros ID: canjea el código, entrega el token de acceso a la API y abre la sesión de GESTRO. */
export function Callback() {
  const nav = useNavigate();
  const { ingresar } = useSesion();
  const [error, setError] = useState<string | null>(null);
  const hecho = useRef(false); // StrictMode ejecuta el efecto dos veces; el código solo sirve una

  useEffect(() => {
    if (hecho.current) return;
    hecho.current = true;
    (async () => {
      try {
        const cfg = await api.kyrosIdConfig();
        const { accessToken, destino } = await completarIngreso(cfg);
        const r = await api.kyrosIdCanjear({ accessToken });
        if (r.estado === 'sesion') { ingresar(r.sesion); nav(destino, { replace: true }); return; }
        // El token de registro viaja solo en memoria de esta navegación, nunca en la URL.
        nav('/registro', { replace: true, state: { registroToken: r.registroToken, puedeRegistrarse: r.puedeRegistrarse } });
      } catch (e) {
        // Administrador de plataforma sin ingreso reciente: una sola vez se reinicia pidiendo contraseña y segundo factor.
        if ((e as { cuerpo?: { code?: string } }).cuerpo?.code === 'PLATAFORMA_REAUTH') {
          const ya = sessionStorage.getItem('gestro.reauth') === '1';
          sessionStorage.removeItem('gestro.reauth');
          if (!ya) { sessionStorage.setItem('gestro.reauth', '1'); await iniciarIngreso(await api.kyrosIdConfig(), { reauth: true, destino: '/app/plataforma' }); return; }
          setError('No pudimos confirmar tu identidad como administrador de plataforma. Vuelve a intentarlo.'); return;
        }
        const estado = (e as { status?: number }).status;
        setError(mensajeDeIngreso(estado, (e as Error).message));
      }
    })();
  }, [ingresar, nav]);

  if (!error) return <Cargando texto="Verificando tu ingreso…" />;
  return (
    <TarjetaCentrada>
      <Marca />
      <p role="alert" className="font-body-md text-body-md text-error">{error}</p>
      <Link to="/" className={clases.secundario}>Volver a intentar</Link>
    </TarjetaCentrada>
  );
}
