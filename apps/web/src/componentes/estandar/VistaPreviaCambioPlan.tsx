import { lineasVistaPrevia, type VistaPreviaCambioPlan as Datos } from '../../lib/kyros-estandar';

/** S-06: vista previa ÚNICA de un cambio de plan (crédito, costo, días, fecha efectiva). Las líneas salen del estándar; `nota` es la regla propia del sistema. */
export function VistaPreviaCambioPlan({ datos, titulo = 'Así quedaría el cambio de plan', nota }: { datos: Datos; titulo?: string; nota?: string }) {
  return (
    <section aria-label={titulo} data-testid="vista-previa-cambio-plan" className="rounded-xl border border-outline-variant bg-surface-container-low p-space-sm flex flex-col gap-space-xs">
      <h3 className="font-label-lg text-label-lg text-primary">{titulo}</h3>
      <ul className="font-body-sm text-body-sm list-disc pl-space-md">{lineasVistaPrevia(datos).map((l) => <li key={l}>{l}</li>)}</ul>
      {nota && <p className="font-body-sm text-on-surface-variant">{nota}</p>}
    </section>
  );
}
