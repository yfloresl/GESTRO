import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { GRUPOS } from '../componentes/Shell';
import { api, useSesion } from '../lib/sesion';

const hoy = () => new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/La_Paz' }).format(new Date());

/** Inicio del dueño. En F0 muestra la sucursal real y el estado de la suscripción; los tableros llegan con cada fase. */
export function Panel() {
  const { sesion, sucursalId } = useSesion();
  const q = useQuery({ queryKey: ['sucursal', sucursalId], queryFn: () => api.sucursal(sucursalId!), enabled: !!sucursalId });
  const nombre = sesion?.usuario.nombre.split(' ')[0] ?? '';
  const vence = q.data?.pagadoHasta ? new Date(`${q.data.pagadoHasta}T12:00:00-04:00`) : null;
  const dias = vence ? Math.ceil((vence.getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <div className="flex items-center gap-space-xs text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider mb-1">
          <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">corporate_fare</span>
          <span>{q.data?.nombre ?? 'Sucursal'}</span>
        </div>
        <h1 className="font-headline-xl-mobile md:font-headline-xl text-headline-xl-mobile md:text-headline-xl text-primary tracking-tight">Hola, {nombre}</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-0.5 first-letter:uppercase">{hoy()}</p>
      </div>

      {!sucursalId ? (
        <Vacio icono="store" titulo="Todavía no tienes una sucursal" texto="Pide a tu administrador que te asigne una o abre tu restaurante con «Crear mi cuenta»." />
      ) : q.isLoading ? (
        <div role="status" className="text-on-surface-variant">Cargando sucursal…</div>
      ) : q.isError ? (
        <div role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-md">No pudimos cargar la sucursal. Inténtalo otra vez.</div>
      ) : (
        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4">
          <Tarjeta etiqueta="Estado" valor={q.data!.estado === 'activo' ? 'Activa' : q.data!.estado} detalle="Suscripción de la sucursal" />
          <Tarjeta etiqueta="Habilitada hasta" valor={q.data!.pagadoHasta ?? '—'} detalle={dias === null ? 'Sin fecha' : dias >= 0 ? `Faltan ${dias} días` : 'Solo lectura'} alerta={dias !== null && dias < 0} />
          <Tarjeta etiqueta="Documento de cobro" valor={q.data!.modoDeCobro === 'recibo' ? 'Recibo' : q.data!.modoDeCobro === 'factura' ? 'Factura' : 'Solo contabilizar'} detalle="Define la caja" />
          <Tarjeta etiqueta="Módulos" valor={`${GRUPOS.flatMap((g) => g.items).length}`} detalle="Se activan por fases" />
        </div>
      )}
    </div>
  );
}

function Tarjeta({ etiqueta, valor, detalle, alerta }: { etiqueta: string; valor: string; detalle: string; alerta?: boolean }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] p-space-md flex flex-col gap-space-xs">
      <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">{etiqueta}</span>
      <span className="font-label-lg text-headline-md font-semibold text-primary">{valor}</span>
      <span className={`font-body-sm text-body-sm ${alerta ? 'text-error font-semibold' : 'text-on-surface-variant'}`}>{detalle}</span>
    </div>
  );
}

export function Vacio({ icono, titulo, texto }: { icono: string; titulo: string; texto: string }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-xl flex flex-col items-center text-center gap-space-sm">
      <span className="material-symbols-outlined text-[40px] text-primary" aria-hidden="true">{icono}</span>
      <h2 className="font-headline-sm text-headline-sm text-on-surface">{titulo}</h2>
      <p className="font-body-md text-body-md text-on-surface-variant max-w-md">{texto}</p>
    </div>
  );
}

/** Módulos de las fases siguientes (F1 en adelante): estado vacío derivado del patrón de tarjeta del diseño. */
export function EnConstruccion() {
  const ruta = useLocation().pathname.split('/').pop();
  const item = GRUPOS.flatMap((g) => g.items).find((i) => i.ruta === ruta);
  return (
    <div className="flex flex-col gap-space-lg">
      <h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">{item?.texto ?? 'Módulo'}</h1>
      <Vacio icono={item?.icono ?? 'construction'} titulo="Este módulo llega en una próxima fase" texto="GESTRO se entrega por fases. Cuando esta parte esté lista, aparecerá aquí con tus datos reales." />
    </div>
  );
}
