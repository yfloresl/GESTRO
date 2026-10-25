import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { clases, Marca, TarjetaCentrada } from '../componentes/Marca';
import { api, useSesion } from '../lib/sesion';

interface Estado { registroToken: string; puedeRegistrarse: boolean }

/**
 * Identidad de Kyros ID sin vínculo. Dos caminos, nunca por correo:
 *  - cuenta recién creada con «Crear mi cuenta»: «Completa tu registro» y se abre el restaurante;
 *  - personal invitado: el código de invitación del dueño prueba quién ocupa el usuario.
 */
export function Registro() {
  const estado = useLocation().state as Estado | null;
  const nav = useNavigate();
  const { ingresar } = useSesion();
  const [modo, setModo] = useState<'registro' | 'codigo'>(estado?.puedeRegistrarse ? 'registro' : 'codigo');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  if (!estado) return <Navigate to="/" replace />;

  const enviar = (accion: () => Promise<Parameters<typeof ingresar>[0]>) => async (e: FormEvent) => {
    e.preventDefault(); setError(null); setEnviando(true);
    try { ingresar(await accion()); nav('/app', { replace: true }); }
    catch (err) {
      const c = (err as { cuerpo?: { message?: string }; status?: number });
      setError(c.status === 401 ? 'Tu ingreso venció. Vuelve a entrar con Kyros ID.' : c.cuerpo?.message ?? 'No pudimos completar el paso.');
    } finally { setEnviando(false); }
  };

  const campo = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

  return (
    <TarjetaCentrada>
      <Marca />
      {modo === 'registro' ? (
        <form className="flex flex-col gap-space-md" onSubmit={(e) => {
          const f = new FormData(e.currentTarget);
          return enviar(() => api.kyrosIdRegistrar({ registroToken: estado.registroToken, nombre: campo(f, 'nombre'), correo: campo(f, 'correo'), restaurante: campo(f, 'restaurante'), razonSocial: campo(f, 'razonSocial'), nit: campo(f, 'nit') || undefined }))(e);
        }}>
          <div>
            <h1 className="font-headline-md text-headline-md text-primary">Completa tu registro</h1>
            <p className="font-body-md text-body-md text-on-surface-variant mt-space-xs">Con estos datos abrimos tu restaurante. Tienes 15 días de prueba.</p>
          </div>
          {[['nombre', 'Tu nombre', 'name'], ['correo', 'Correo de contacto', 'email'], ['restaurante', 'Nombre del restaurante', 'organization'], ['razonSocial', 'Razón social', 'organization'], ['nit', 'NIT (opcional)', 'off']].map(([k, et, ac]) => (
            <label key={k} className="flex flex-col gap-space-xs">
              <span className={clases.etiqueta}>{et}</span>
              <input name={k} required={k !== 'nit'} type={k === 'correo' ? 'email' : 'text'} autoComplete={ac} className={clases.input} />
            </label>
          ))}
          {error && <p role="alert" className="text-error font-body-sm text-body-sm">{error}</p>}
          <button className={clases.primario} disabled={enviando}>{enviando ? 'Creando…' : 'Abrir mi restaurante'}</button>
          <button type="button" className="text-primary font-body-sm text-body-sm underline self-center" onClick={() => setModo('codigo')}>Tengo un código de invitación</button>
        </form>
      ) : (
        <form className="flex flex-col gap-space-md" onSubmit={(e) => { const f = new FormData(e.currentTarget); return enviar(() => api.kyrosIdVincular({ registroToken: estado.registroToken, codigo: campo(f, 'codigo') }))(e); }}>
          <div>
            <h1 className="font-headline-md text-headline-md text-primary">Código de invitación</h1>
            <p className="font-body-md text-body-md text-on-surface-variant mt-space-xs">Tu administrador te dio un código de un solo uso. Pégalo aquí para unir tu Kyros ID a tu usuario.</p>
          </div>
          <label className="flex flex-col gap-space-xs">
            <span className={clases.etiqueta}>Código</span>
            <input name="codigo" required autoComplete="off" className={`${clases.input} font-label-lg`} />
          </label>
          {error && <p role="alert" className="text-error font-body-sm text-body-sm">{error}</p>}
          <button className={clases.primario} disabled={enviando}>{enviando ? 'Verificando…' : 'Unir mi cuenta'}</button>
          {estado.puedeRegistrarse && <button type="button" className="text-primary font-body-sm text-body-sm underline self-center" onClick={() => setModo('registro')}>Quiero abrir un restaurante nuevo</button>}
        </form>
      )}
    </TarjetaCentrada>
  );
}
