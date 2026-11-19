import { useState } from 'react';
import { DEMOSTRACION, enmascarar } from '../../lib/kyros-estandar';

/** S-11: aviso PERMANENTE de qué es demostración + contraseña de la cuenta de prueba oculta tras un botón (nunca en claro por defecto). */
export function AvisoDemostracion({ contrasena }: { contrasena?: string | null }) {
  const [visible, setVisible] = useState(false);
  return (
    <div data-testid="aviso-demostracion" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm flex flex-col gap-space-xs">
      <p role="note" className="font-semibold">{DEMOSTRACION.AVISO_PERMANENTE}</p>
      {contrasena ? (
        <p className="flex flex-wrap items-center gap-space-xs">
          <code data-testid="contrasena-demo">{visible ? contrasena : enmascarar(contrasena)}</code>
          <button type="button" aria-pressed={visible} onClick={() => setVisible((v) => !v)} className="h-12 px-space-sm rounded-lg border border-outline-variant font-label-md">{visible ? DEMOSTRACION.BOTON_OCULTAR_CONTRASENA : DEMOSTRACION.BOTON_MOSTRAR_CONTRASENA}</button>
        </p>
      ) : null}
    </div>
  );
}
