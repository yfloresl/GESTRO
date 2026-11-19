import { useState } from 'react';
import { AvisoDemostracion as AvisoComun } from '../../lib/kyros-estandar-ui';
import { DEMOSTRACION, enmascarar } from '../../lib/kyros-local';
/** S-11: aviso PERMANENTE del estándar + contraseña de la cuenta de prueba oculta tras un botón (nunca en claro por defecto). */
export function AvisoDemostracion({ contrasena }: { contrasena?: string | null }) {
  const [visible, setVisible] = useState(false);
  return (
    <div data-testid="aviso-demostracion" className="flex flex-col gap-space-xs">
      <AvisoComun />
      {contrasena ? (
        <p className="flex flex-wrap items-center gap-space-xs">
          <code data-testid="contrasena-demo">{visible ? contrasena : enmascarar(contrasena)}</code>
          <button type="button" aria-pressed={visible} onClick={() => setVisible((v) => !v)} className="h-12 px-space-sm rounded-lg border border-outline-variant font-label-md">{visible ? DEMOSTRACION.BOTON_OCULTAR_CONTRASENA : DEMOSTRACION.BOTON_MOSTRAR_CONTRASENA}</button>
        </p>
      ) : null}
    </div>
  );
}
