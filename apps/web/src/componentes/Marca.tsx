/** Logo de GESTRO: mismo bloque que el diseño (cuadro primario con icono + nombre en dos líneas). */
export function Marca() {
  return (
    <div className="flex items-center gap-space-sm">
      <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-on-primary shadow-sm">
        <span className="material-symbols-outlined text-[22px]" aria-hidden="true">restaurant</span>
      </div>
      <div className="flex flex-col">
        <span className="font-headline-sm text-headline-sm text-primary tracking-tight leading-none">Gestro</span>
        <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider mt-0.5">Restaurantes</span>
      </div>
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div role="status" className="min-h-screen flex items-center justify-center text-on-surface-variant font-body-md text-body-md">
      <span className="material-symbols-outlined animate-spin mr-space-sm" aria-hidden="true">progress_activity</span>{texto}
    </div>
  );
}

/** Tarjeta centrada de las pantallas de ingreso. */
export function TarjetaCentrada({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-margin py-space-lg bg-background">
      <section className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] p-space-lg flex flex-col gap-space-md">
        {children}
      </section>
    </main>
  );
}

export const clases = {
  primario: 'h-14 w-full rounded-lg bg-primary text-on-primary font-body-md text-body-md font-semibold flex items-center justify-center gap-space-sm hover:bg-primary-container transition-colors disabled:opacity-60',
  secundario: 'h-12 w-full rounded-lg border border-outline-variant text-primary font-body-md text-body-md font-semibold flex items-center justify-center hover:bg-surface-container-low transition-colors',
  input: 'h-[52px] w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-space-md text-body-lg font-body-md focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary',
  etiqueta: 'font-label-md text-label-md text-on-surface-variant uppercase tracking-wide',
};
