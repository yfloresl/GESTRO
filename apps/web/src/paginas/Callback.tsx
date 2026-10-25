import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cargando, clases, Marca, TarjetaCentrada } from '../componentes/Marca';
import { completarIngreso } from '../lib/kyrosid';
import { api, useSesion } from '../lib/sesion';

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
        const estado = (e as { status?: number }).status;
        setError(estado === 403 ? 'Tu cuenta está desactivada. Habla con el administrador de tu restaurante.' : estado === 503 ? 'Kyros ID no responde. Inténtalo en un momento.' : (e as Error).message || 'No pudimos completar el ingreso.');
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
