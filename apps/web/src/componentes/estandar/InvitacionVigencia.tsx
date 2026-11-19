import { useState } from 'react';
import { InvitacionEnlace } from '../../lib/kyros-estandar-ui';
import { TXT, diasParaVencer } from '../../lib/kyros-estandar';
/** S-08: invitación con el componente del estándar (enlace, vigencia y «Copiar enlace» / «Reenviar invitación» con un clic). Sin enlace (ya no se muestra) solo la vigencia. */
export function InvitacionVigencia({ enlace, venceEn, onReenviar }: { enlace?: string | null; venceEn?: string | null; onReenviar?: () => Promise<void> | void }) {
  const [copiado, setCopiado] = useState(false); const [ocupado, setOcupado] = useState(false);
  const vencida = !!venceEn && diasParaVencer(venceEn) === 0;
  const copiar = async () => { if (!enlace) return; try { await navigator.clipboard.writeText(enlace); setCopiado(true); } catch { setCopiado(false); } };
  const reenviar = onReenviar ? async () => { setOcupado(true); try { await onReenviar(); } finally { setOcupado(false); } } : undefined;
  if (!enlace) return <p role="status" data-testid="invitacion" className={vencida ? 'text-error font-semibold' : 'text-on-surface-variant'}>{TXT.invitacionVigencia(diasParaVencer(venceEn))}</p>;
  return (
    <div data-testid="invitacion">
      <InvitacionEnlace enlace={enlace} venceEn={venceEn ?? null} onCopiar={vencida ? undefined : () => void copiar()} onReenviar={reenviar} ocupado={ocupado} />
      {copiado && <p role="status" className="font-body-sm text-on-surface-variant">Enlace copiado</p>}
    </div>
  );
}
