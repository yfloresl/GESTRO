import { useState } from 'react';
import { BOTONES, vigenciaInvitacion } from '../../lib/kyros-estandar';

/** S-08: invitación ÚNICA: enlace visible, vigencia visible y «Copiar enlace» / «Reenviar invitación» con un clic. */
export function InvitacionVigencia({ enlace, venceEn, onReenviar, ahora }: { enlace?: string | null; venceEn?: string | null; onReenviar?: () => Promise<void> | void; ahora?: Date }) {
  const v = vigenciaInvitacion(venceEn, ahora); const [copiado, setCopiado] = useState(false); const [ocupado, setOcupado] = useState(false);
  const copiar = async () => { if (!enlace) return; try { await navigator.clipboard.writeText(enlace); setCopiado(true); } catch { setCopiado(false); } };
  return (
    <div data-testid="invitacion" className="flex flex-col gap-space-xs rounded-lg border border-outline-variant p-space-sm">
      {enlace && <input readOnly value={enlace} aria-label="Enlace de invitación" onFocus={(e) => e.currentTarget.select()} className="h-12 px-space-sm rounded-lg border border-outline-variant bg-surface w-full" />}
      <p role="status" className={v.vencida ? 'text-error font-semibold' : 'text-on-surface-variant'}>{v.texto}</p>
      <div className="flex flex-wrap gap-space-xs">
        {enlace && !v.vencida && <button type="button" onClick={copiar} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold">{copiado ? 'Enlace copiado' : BOTONES.copiarEnlace}</button>}
        {onReenviar && <button type="button" disabled={ocupado} onClick={async () => { setOcupado(true); try { await onReenviar(); } finally { setOcupado(false); } }} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold">{BOTONES.reenviarInvitacion}</button>}
      </div>
    </div>
  );
}
