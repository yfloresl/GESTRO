import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Cargando, clases, Marca, TarjetaCentrada } from '../componentes/Marca';
import { destinoSeguro, iniciarIngreso } from '../lib/kyrosid';
import { api, useSesion } from '../lib/sesion';

/** Un solo ingreso visible: «Entrar con Kyros ID». También atiende /entrar?destino= (entrada directa desde el Portal). */
interface PlanesPublicos { publicado: boolean; planes?: { codigo: string; nombre: string; usd: number; modulos: { codigo: string; nombre: string }[] }[]; tipoCambio?: { bob: number; fecha: string; vigente: boolean } | null; nota?: string }

/** «Planes y precios»: solo aparece si plataforma lo publicó (interruptor apagado por defecto). USD siempre; Bs al tipo de cambio del día con su fecha. */
function PlanesYPrecios() {
  const q = useQuery({ queryKey: ['planes-publicos'], queryFn: async () => (await fetch('/api/v1/public/planes')).json() as Promise<PlanesPublicos>, retry: 0, staleTime: 3_600_000 });
  if (!q.data?.publicado || !q.data.planes?.length) return null;
  const tc = q.data.tipoCambio;
  return (
    <section aria-labelledby="planes" className="flex flex-col gap-space-sm border-t border-outline-variant pt-space-md">
      <h2 id="planes" className="font-headline-sm text-headline-sm text-primary">Planes y precios</h2>
      <ul className="flex flex-col gap-space-xs">{q.data.planes.map((p) => (
        <li key={p.codigo} className="rounded-xl border border-outline-variant p-space-sm">
          <details>
            <summary className="flex items-baseline justify-between gap-space-sm cursor-pointer min-h-12 items-center"><span className="font-semibold">{p.nombre}</span>
              <span className="text-right"><span className="font-label-lg text-primary">USD {p.usd}/mes</span>{tc && <span className="block font-body-sm text-on-surface-variant">≈ Bs {(p.usd * tc.bob).toFixed(2)}</span>}</span></summary>
            <ul className="mt-space-xs list-disc pl-space-md font-body-sm text-on-surface-variant">{p.modulos.map((m) => <li key={m.codigo}>{m.nombre}</li>)}</ul>
          </details>
        </li>))}</ul>
      <p className="font-body-sm text-on-surface-variant">{q.data.nota}{tc ? ` Bs al tipo de cambio ${tc.vigente ? 'del' : 'conocido al'} ${tc.fecha}.` : ' Precios en dólares.'}</p>
    </section>
  );
}

export function Ingreso({ directo = false }: { directo?: boolean }) {
  const { estado } = useSesion();
  const [params] = useSearchParams();
  const destino = destinoSeguro(params.get('destino'));
  const [error, setError] = useState<string | null>(null);
  const cfg = useQuery({ queryKey: ['kyros-id-config'], queryFn: () => api.kyrosIdConfig(), retry: 1 });

  if (estado === 'cargando' || cfg.isLoading) return <Cargando />;
  if (estado === 'activa') return <Navigate to={destino} replace />;

  const ir = (registro: boolean) => {
    if (!cfg.data) return;
    setError(null);
    iniciarIngreso(cfg.data, { registro, destino }).catch(() => setError('No pudimos abrir Kyros ID. Inténtalo otra vez.'));
  };
  // /entrar: ingreso silencioso, sin pasar por la portada (si Kyros ID ya tiene sesión, no pide contraseña).
  if (directo && cfg.data?.activo && !error) { ir(false); return <Cargando texto="Entrando con Kyros ID…" />; }

  return (
    <TarjetaCentrada>
      <Marca />
      <div>
        <h1 className="font-headline-md text-headline-md text-primary">Ingresa a tu restaurante</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-space-xs">Usa tu cuenta Kyros ID. Es la misma para todos los sistemas de Kyros-Tech.</p>
      </div>
      {cfg.isError || (cfg.data && !cfg.data.activo) ? (
        <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-md font-body-sm text-body-sm">
          El ingreso con Kyros ID no está disponible por ahora. Inténtalo en unos minutos.
        </p>
      ) : (
        <div className="flex flex-col gap-space-sm">
          <button type="button" className={clases.primario} onClick={() => ir(false)} disabled={!cfg.data}>
            <span className="material-symbols-outlined" aria-hidden="true">login</span>Entrar con Kyros ID
          </button>
          <button type="button" className={clases.secundario} onClick={() => ir(true)} disabled={!cfg.data}>Crear mi cuenta</button>
        </div>
      )}
      {error && <p role="alert" className="text-error font-body-sm text-body-sm">{error}</p>}
      <PlanesYPrecios />
    </TarjetaCentrada>
  );
}
