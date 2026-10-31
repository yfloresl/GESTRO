import type { ReactNode } from 'react';

/** Panel lateral de «ficha» (detalle de un cliente o comensal). Mismo patrón que los demás paneles de la app. */
export function Ficha({ titulo, subtitulo, cerrar, children }: { titulo: string; subtitulo?: string; cerrar(): void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={`Ficha de ${titulo}`} className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-start justify-between gap-space-sm">
          <div className="min-w-0"><h2 className="font-headline-md text-headline-md text-primary truncate">{titulo}</h2>{subtitulo && <p className="font-body-sm text-on-surface-variant">{subtitulo}</p>}</div>
          <button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container shrink-0"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Dato({ etiqueta, valor }: { etiqueta: string; valor: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-space-sm border-b border-outline-variant py-space-xs"><span className="font-label-sm uppercase text-on-surface-variant">{etiqueta}</span><span className="font-body-md text-right">{valor}</span></div>;
}

export const Telefono = ({ valor }: { valor: string | null }) => (valor ? <a href={`tel:${valor}`} className="text-primary underline">{valor}</a> : <>Sin teléfono</>);
