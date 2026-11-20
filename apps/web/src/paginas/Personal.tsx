import { TXT } from '../lib/kyros-estandar';
import { textoVigencia } from '../lib/kyros-local';
import { InvitacionVigencia } from '../componentes/estandar/InvitacionVigencia';
import { confirmar } from '../componentes/Dialogos';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { ROLES } from '@gestro/contracts';
import { clases } from '../componentes/Marca';
import { api, ETIQUETA_ROL, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { ListaEsqueleto } from '../componentes/Esqueleto';

interface Persona { id: string; nombre: string; correo: string | null; telefono: string | null; activo: boolean; roles: string[]; vinculado: boolean; invitacion?: { venceEl: string; vencida: boolean } | null }
interface Codigo { id?: string; codigo: string; venceEl: string }
const ASIGNABLES = ROLES.filter((r) => r !== 'owner');

/** GS-N07: alterna un rol en la lista editada (siempre queda al menos uno al guardar; el dueño no se asigna). */
export function alternarRol(actuales: readonly string[], rol: string): string[] {
  return actuales.includes(rol) ? actuales.filter((x) => x !== rol) : [...actuales, rol];
}

/** Personal: alta con rol y código de invitación de un solo uso (la persona lo pega al entrar con Kyros ID). */
export function Personal() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['personal', sucursalId], queryFn: () => api.get<Persona[]>('/personal', sucursalId!), enabled: !!sucursalId });
  const [codigo, setCodigo] = useState<(Codigo & { para: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>(['mesero']);
  const [edicion, setEdicion] = useState<{ id: string; roles: string[] } | null>(null);
  const refrescar = () => qc.invalidateQueries({ queryKey: ['personal', sucursalId] });

  const crear = useMutation({
    mutationFn: (d: { nombre: string; correo: string; telefono?: string; roles: string[] }) => api.post<Codigo>('/personal', d, sucursalId!),
    onSuccess: (r, d) => { setCodigo({ ...r, para: d.nombre }); void refrescar(); }, onError: (e) => setError(mensajeDeError(e)),
  });
  const alta = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); const form = e.currentTarget;
    if (!roles.length) { setError('Elige al menos un rol.'); return; }
    crear.mutate({ nombre: String(f.get('nombre')).trim(), correo: String(f.get('correo')).trim(), telefono: String(f.get('telefono')).trim() || undefined, roles }, { onSuccess: () => { form.reset(); setRoles(['mesero']); /* GST-017: el rol no queda marcado de la persona anterior */ } });
  };
  const accion = async (f: () => Promise<unknown>) => { setError(null); try { await f(); await refrescar(); } catch (e) { setError(mensajeDeError(e)); } };

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Personal</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">Da de alta a tu equipo con su rol. Cada persona entra con su propio Kyros ID usando un código de un solo uso.</p>
      </header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}

      {codigo && (
        <section role="status" className="rounded-xl border-2 border-primary bg-primary-fixed p-space-md flex flex-col gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm text-on-primary-fixed">Invitación para {codigo.para}</h2>
          <p className="text-on-primary-fixed-variant">Envíale el enlace: <strong>no volverá a mostrarse</strong>. Entra con «{TXT.entrarKyrosId}» y el código ya viene escrito. También puede pegar el código a mano: <code className="select-all">{codigo.codigo}</code>.</p>
          <InvitacionVigencia enlace={`${location.origin}/entrar?codigo=${encodeURIComponent(codigo.codigo)}`} venceEn={codigo.venceEl} />
          <button type="button" onClick={() => setCodigo(null)} className="h-12 px-space-md rounded-lg border border-outline text-on-primary-fixed self-start">Ya lo entregué</button>
        </section>
      )}

      <form onSubmit={alta} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-1 gap-space-sm md:grid-cols-2">
        <h2 className="font-headline-sm text-headline-sm md:col-span-2">Agregar persona</h2>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Nombre completo</span><input name="nombre" required minLength={2} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Correo</span><input name="correo" type="email" required className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Teléfono (opcional)</span><input name="telefono" inputMode="tel" className={clases.input} /></label>
        <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Roles</legend>
          <div className="flex flex-wrap gap-space-xs">{ASIGNABLES.map((r) => (
            <button key={r} type="button" aria-pressed={roles.includes(r)} onClick={() => setRoles((a) => (a.includes(r) ? a.filter((x) => x !== r) : [...a, r]))} className={`h-10 px-space-sm rounded-full border font-label-md text-label-md ${roles.includes(r) ? 'bg-primary-container text-on-primary border-primary-container' : 'border-outline-variant text-on-surface-variant'}`}>{ETIQUETA_ROL[r]}</button>
          ))}</div>
        </fieldset>
        <button disabled={crear.isPending} className={`${clases.primario} md:col-span-2`}>{crear.isPending ? 'Creando…' : 'Crear y generar código'}</button>
      </form>

      {q.isLoading ? <ListaEsqueleto /> : (q.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Todavía no agregaste a nadie. Tú, como dueño, ya tienes acceso completo.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
          {q.data!.map((p) => (
            <li key={p.id} className={`bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm ${p.activo ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-space-sm">
                <div className="min-w-0"><h3 className="font-body-lg font-semibold truncate">{p.nombre}</h3><p className="font-body-sm text-on-surface-variant truncate">{p.correo}</p></div>
                <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm uppercase whitespace-nowrap ${!p.activo ? 'bg-surface-container text-on-surface-variant' : p.vinculado ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : 'bg-secondary-fixed text-on-secondary-fixed-variant'}`}>{!p.activo ? 'Inactivo' : p.vinculado ? 'Con Kyros ID' : 'Pendiente de unirse'}</span>
              </div>
              {edicion?.id === p.id ? (
                <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>Roles de {p.nombre}</legend>
                  <div className="flex flex-wrap gap-space-xs">{ASIGNABLES.map((r) => (
                    <button key={r} type="button" aria-pressed={edicion.roles.includes(r)} onClick={() => setEdicion({ id: p.id, roles: alternarRol(edicion.roles, r) })} className={`h-10 px-space-sm rounded-full border font-label-md text-label-md ${edicion.roles.includes(r) ? 'bg-primary-container text-on-primary border-primary-container' : 'border-outline-variant text-on-surface-variant'}`}>{ETIQUETA_ROL[r]}</button>
                  ))}</div>
                  <div className="flex flex-wrap gap-space-sm">
                    <button type="button" disabled={edicion.roles.length === 0 || edicion.roles.length > 4} onClick={() => accion(async () => { await api.patch(`/personal/${p.id}`, { roles: edicion.roles }, sucursalId!); setEdicion(null); })} className="h-12 px-space-md rounded-lg bg-primary-container text-on-primary font-semibold disabled:opacity-50">Guardar roles</button>
                    <button type="button" onClick={() => setEdicion(null)} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold">Cancelar</button>
                  </div>
                  {(edicion.roles.length === 0 || edicion.roles.length > 4) && <p role="status" className="font-body-sm text-body-sm text-error">{edicion.roles.length === 0 ? 'Elige al menos un rol.' : 'Una persona puede tener hasta 4 roles.'}</p>}
                </fieldset>
              ) : (
                <div className="flex flex-wrap items-center gap-1">{p.roles.map((r) => <span key={r} className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm">{ETIQUETA_ROL[r] ?? r}</span>)}
                  {p.activo && <button type="button" onClick={() => setEdicion({ id: p.id, roles: p.roles.filter((r) => r !== 'owner') })} className="ml-space-xs px-2 py-0.5 rounded border border-outline-variant text-primary font-label-sm text-label-sm">Cambiar roles</button>}
                </div>
              )}
              {!p.vinculado && p.activo && (
                <p className="font-body-sm text-on-surface-variant">{p.invitacion ? `Invitación de un solo uso. ${textoVigencia(p.invitacion.venceEl)}` : 'Sin invitación vigente: reenvía una nueva con un clic.'}</p>
              )}
              <div className="flex flex-wrap gap-space-sm">
                {!p.vinculado && p.activo && p.invitacion && !p.invitacion.vencida && <button type="button" onClick={async () => { if (await confirmar({ titulo: 'Revocar código', mensaje: `¿Anular el código pendiente de ${p.nombre}? Ya no podrá usarlo; podrás generar otro.`, aceptar: 'Revocar', peligro: true })) accion(async () => { await api.del(`/personal/${p.id}/codigo`, undefined, sucursalId!); }); }} className="h-12 px-space-md rounded-lg border border-outline-variant text-error font-semibold">Revocar código</button>}
                {!p.vinculado && p.activo && <button type="button" onClick={() => accion(async () => setCodigo({ ...(await api.post<Codigo>(`/personal/${p.id}/codigo`, undefined, sucursalId!)), para: p.nombre }))} className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold">{TXT.reenviar}</button>}
                <button type="button" onClick={async () => (await confirmar({ titulo: p.activo ? 'Desactivar persona' : 'Reactivar persona', mensaje: p.activo ? `¿Desactivar a ${p.nombre}? Perderá el acceso de inmediato.` : `¿Reactivar a ${p.nombre}?`, aceptar: p.activo ? 'Desactivar' : 'Reactivar', peligro: p.activo })) && accion(() => api.patch(`/personal/${p.id}`, { activo: !p.activo }, sucursalId!))} className={`h-12 px-space-md rounded-lg border font-semibold ${p.activo ? 'border-error text-error' : 'border-outline-variant text-primary'}`}>{p.activo ? 'Desactivar' : 'Reactivar'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
