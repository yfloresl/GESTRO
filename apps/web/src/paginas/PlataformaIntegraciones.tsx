import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { ListaEsqueleto } from '../componentes/Esqueleto';
import { clases } from '../componentes/Marca';
import { iniciarIngreso } from '../lib/kyrosid';
import { api, mensajeDeError } from '../lib/sesion';

interface Secreto { clave: string; nombre: string; uso: string; estado: 'configurada' | 'no_configurada'; actualizado: string | null; deshabilitadaEn: string | null }

/** Integraciones: secretos del catálogo cerrado. Solo escritura: el valor se pega, se guarda cifrado y nunca vuelve a mostrarse. */
export function PlataformaIntegraciones() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [reauth, setReauth] = useState(false); const [ocupado, setOcupado] = useState(false);
  const q = useQuery({ queryKey: ['plataforma-secretos'], queryFn: () => api.get<Secreto[]>('/plataforma/secretos') });
  const cfg = useQuery({ queryKey: ['kyros-id-config'], queryFn: () => api.kyrosIdConfig(), staleTime: Infinity });

  const accion = async (f: () => Promise<unknown>, ok: string) => {
    setError(null); setMsg(null); setReauth(false); setOcupado(true);
    try { await f(); setMsg(ok); await qc.invalidateQueries({ queryKey: ['plataforma-secretos'] }); }
    catch (e) { if ((e as { cuerpo?: { code?: string } })?.cuerpo?.code === 'REAUTH_REQUERIDA') setReauth(true); setError(mensajeDeError(e)); }
    finally { setOcupado(false); }
  };
  const guardar = (clave: string) => (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault(); const form = ev.currentTarget; const valor = String(new FormData(form).get('valor') ?? '').trim();
    void accion(async () => { await api.put(`/plataforma/secretos/${clave}`, { valor }); form.reset(); }, 'Guardado. El valor ya no se puede volver a ver.');
  };
  const confirmar = () => { if (cfg.data) void iniciarIngreso(cfg.data, { reauth: true, destino: '/app/plataforma' }); };

  return (
    <section className="flex flex-col gap-space-md">
      <p className="text-on-surface-variant">Secretos para que GESTRO llame a otros sistemas. Se pegan aquí (nunca por chat ni en el repositorio), se guardan cifrados y no se pueden leer después. Quitar un secreto lo deshabilita; queda el rastro en la auditoría.</p>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}{reauth && <> <button type="button" onClick={confirmar} className="underline font-semibold">Confirmar mi identidad</button></>}</p>}
      {msg && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}
      {q.isLoading ? <ListaEsqueleto filas={1} /> : (q.data ?? []).map((s) => (
        <form key={s.clave} onSubmit={guardar(s.clave)} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
          <div className="flex flex-wrap items-center justify-between gap-space-sm"><h2 className="font-body-lg font-semibold break-all">{s.clave}</h2>
            <span className={`px-2 py-0.5 rounded-full font-label-sm uppercase ${s.estado === 'configurada' ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : 'bg-surface-container text-on-surface-variant'}`}>{s.estado === 'configurada' ? 'Configurada' : 'No configurada'}</span></div>
          <p className="font-body-sm text-on-surface-variant">{s.nombre}. {s.uso}</p>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Pegar el valor (solo escritura)</span><input name="valor" type="password" autoComplete="off" required minLength={16} maxLength={512} className={clases.input} /></label>
          <div className="flex flex-wrap gap-space-sm"><button disabled={ocupado} className={`${clases.primario} sm:w-auto sm:px-space-lg`}>{s.estado === 'configurada' ? 'Reemplazar' : 'Guardar'}</button>
            {s.estado === 'configurada' && <button type="button" disabled={ocupado} onClick={() => confirm(`¿Deshabilitar ${s.clave}? Las llamadas que la usen dejarán de funcionar.`) && void accion(() => api.del(`/plataforma/secretos/${s.clave}`), 'Deshabilitado.')} className={`${clases.secundario} sm:w-auto sm:px-space-lg`}>Deshabilitar</button>}</div>
        </form>))}
    </section>
  );
}
