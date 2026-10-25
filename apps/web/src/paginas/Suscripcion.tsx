import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';
import { reducirImagen } from '../lib/imagen';

interface Pago { id: string; meses: number; mesesDeRegalo: number; monto: string; esperado: string | null; referencia: string | null; banco: string | null; estado: 'pendiente' | 'validado' | 'rechazado'; motivo: string | null; tieneVoucher: boolean; desde: string | null; hasta: string | null; creado: string }
interface Mia { habilitadaHasta: string | null; diasRestantes: number | null; estado: 'activa' | 'por_vencer' | 'gracia' | 'vencida'; plan: string | null; precioMensual: string | null; diasDeGracia: number; cobro: { instrucciones: string | null; tieneQr: boolean }; pagos: Pago[] }
interface Calculo { meses: number; precioMensual: string | null; montoEsperado: string | null; promocion: { nombre: string; mesesDeRegalo: number; descuentoPct: number } | null }

const ESTADO_PAGO: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'En revisión', clase: 'bg-secondary-fixed text-on-secondary-fixed-variant' },
  validado: { texto: 'Aprobado', clase: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' },
  rechazado: { texto: 'Rechazado', clase: 'bg-error-container text-on-error-container' },
};
const ESTADO_SUS: Record<string, { texto: string; clase: string; icono: string }> = {
  activa: { texto: 'Activa', clase: 'bg-tertiary-fixed text-on-tertiary-fixed-variant', icono: 'check_circle' },
  por_vencer: { texto: 'Por vencer', clase: 'bg-secondary-fixed text-on-secondary-fixed-variant', icono: 'schedule' },
  gracia: { texto: 'En gracia', clase: 'bg-secondary-container text-on-secondary-container', icono: 'warning' },
  vencida: { texto: 'Vencida · solo lectura', clase: 'bg-error-container text-on-error-container', icono: 'lock' },
};

/** Suscripción de la sucursal: estado, QR de cobro, declaración del pago con su comprobante y el historial. */
export function Suscripcion() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['suscripcion', sucursalId], queryFn: () => api.get<Mia>('/suscripcion', sucursalId!), enabled: !!sucursalId });
  const [meses, setMeses] = useState(1);
  const calculo = useQuery({ queryKey: ['suscripcion-calculo', sucursalId, meses], queryFn: () => api.get<Calculo>(`/suscripcion/calculo?meses=${meses}`, sucursalId!), enabled: !!sucursalId });
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [monto, setMonto] = useState('');
  useEffect(() => { if (calculo.data?.montoEsperado) setMonto(calculo.data.montoEsperado); }, [calculo.data?.montoEsperado]);
  useEffect(() => {
    if (!q.data?.cobro.tieneQr || !sucursalId) return;
    let url: string | null = null;
    api.blob('/suscripcion/cobro/qr', sucursalId).then((b) => { url = URL.createObjectURL(b); setQr(url); }).catch(() => undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [q.data?.cobro.tieneQr, sucursalId]);

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); setOk(null); setTrabajando(true);
    const f = new FormData(e.currentTarget); const form = e.currentTarget;
    const archivo = f.get('voucher') as File | null;
    if (!archivo || archivo.size === 0) { setError('Sube la foto del comprobante.'); setTrabajando(false); return; }
    try {
      const creado = await api.post<{ id: string }>('/suscripcion/pagos', { meses, monto: Number(String(f.get('monto')).replace(',', '.')), referencia: String(f.get('referencia')).trim(), banco: String(f.get('banco')).trim() || undefined, fechaPago: String(f.get('fecha')) || undefined }, sucursalId!);
      await api.subirImagen(`/suscripcion/pagos/${creado.id}/voucher`, await reducirImagen(archivo), sucursalId!);
      setOk('Recibimos tu comprobante. Lo revisaremos y te avisaremos cuando esté aprobado.'); form.reset();
      await qc.invalidateQueries({ queryKey: ['suscripcion', sucursalId] });
    } catch (err) { setError(mensajeDeError(err, 'No pudimos enviar el pago. Revisa los datos e inténtalo otra vez.')); } finally { setTrabajando(false); }
  };

  const m = q.data;
  const est = m ? ESTADO_SUS[m.estado] : null;
  return (
    <div className="flex flex-col gap-space-lg max-w-4xl">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Suscripción</h1><p className="font-body-md text-body-md text-on-surface-variant">Cada sucursal se paga por separado, por mes. Si vence, queda en solo lectura: tus datos no se borran.</p></header>
      {q.isLoading ? <p role="status">Cargando…</p> : !m ? <p role="alert" className="text-error">No pudimos cargar la suscripción.</p> : (
        <>
          <section className="grid grid-cols-1 gap-gutter sm:grid-cols-3">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><p className={clases.etiqueta}>Estado</p><p className={`mt-space-xs inline-flex items-center gap-1 px-2 py-1 rounded-full font-label-md ${est!.clase}`}><span className="material-symbols-outlined text-[18px]" aria-hidden="true">{est!.icono}</span>{est!.texto}</p></div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><p className={clases.etiqueta}>Habilitada hasta</p><p className="font-headline-md text-headline-md text-primary font-label-lg">{m.habilitadaHasta ?? '—'}</p><p className="font-body-sm text-on-surface-variant">{m.diasRestantes === null ? '' : m.diasRestantes >= 0 ? `Faltan ${m.diasRestantes} días` : `Venció hace ${-m.diasRestantes} días`}</p></div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><p className={clases.etiqueta}>Plan</p><p className="font-headline-md text-headline-md text-primary">{m.plan ?? 'Sin plan'}</p><p className="font-body-sm text-on-surface-variant">{m.precioMensual ? `${bs(m.precioMensual)} al mes` : 'Kyros-Tech te indicará el monto'}</p></div>
          </section>

          <section className="grid grid-cols-1 gap-gutter md:grid-cols-[16rem_1fr]">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col items-center gap-space-sm text-center">
              <h2 className="font-headline-sm text-headline-sm">1. Paga por tu banco</h2>
              {qr ? <img src={qr} alt="QR de cobro de Kyros-Tech" className="w-48 h-48 object-contain" /> : <p className="text-on-surface-variant font-body-sm">{m.cobro.tieneQr ? 'Cargando QR…' : 'Kyros-Tech todavía no cargó su QR de cobro. Pídelo por soporte.'}</p>}
              {m.cobro.instrucciones && <p className="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-line">{m.cobro.instrucciones}</p>}
            </div>
            <form onSubmit={enviar} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
              <h2 className="font-headline-sm text-headline-sm">2. Sube tu comprobante</h2>
              <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Meses que pagas</span>
                <select value={meses} onChange={(e) => setMeses(Number(e.target.value))} className={clases.input}>{[1, 2, 3, 6, 12].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'mes' : 'meses'}</option>)}</select></label>
              {calculo.data?.promocion && <p role="status" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm font-body-sm"><strong>{calculo.data.promocion.nombre}:</strong> {calculo.data.promocion.mesesDeRegalo > 0 ? `+${calculo.data.promocion.mesesDeRegalo} mes(es) de regalo` : ''}{calculo.data.promocion.descuentoPct > 0 ? ` · ${calculo.data.promocion.descuentoPct}% de descuento` : ''}</p>}
              <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
                <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Monto pagado (Bs)</span><input name="monto" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={monto} onChange={(e) => setMonto(e.target.value)} className={`${clases.input} font-label-lg`} />{calculo.data?.montoEsperado && <span className="font-body-sm text-on-surface-variant">Monto esperado: {bs(calculo.data.montoEsperado)}</span>}</label>
                <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>N° de referencia del comprobante</span><input name="referencia" required minLength={3} maxLength={60} className={`${clases.input} font-label-lg`} /></label>
                <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Banco (opcional)</span><input name="banco" maxLength={60} className={clases.input} /></label>
                <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Fecha del pago (opcional)</span><input name="fecha" type="date" className={clases.input} /></label>
              </div>
              <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Foto del comprobante</span><input name="voucher" type="file" accept="image/jpeg,image/png,image/webp" required className="font-body-sm" /></label>
              {error && <p role="alert" className="text-error">{error}</p>}
              {ok && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{ok}</p>}
              <button disabled={trabajando} className={clases.primario}>{trabajando ? 'Enviando…' : 'Enviar comprobante'}</button>
            </form>
          </section>

          <section aria-labelledby="hist" className="flex flex-col gap-space-sm">
            <h2 id="hist" className="font-headline-sm text-headline-sm">Mis pagos</h2>
            {m.pagos.length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Todavía no declaraste ningún pago.</p> : (
              <ul className="flex flex-col gap-space-xs">{m.pagos.map((p) => (
                <li key={p.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-wrap items-center justify-between gap-space-sm">
                  <div><p className="font-body-md font-semibold">{p.meses} {p.meses === 1 ? 'mes' : 'meses'}{p.mesesDeRegalo ? ` + ${p.mesesDeRegalo} de regalo` : ''} · <span className="font-label-lg">{bs(p.monto)}</span></p><p className="font-body-sm text-on-surface-variant">Ref. {p.referencia} · {new Date(p.creado).toLocaleDateString('es-BO')}{p.estado === 'validado' && p.hasta ? ` · habilita hasta ${p.hasta}` : ''}</p>{p.motivo && <p className="font-body-sm text-error">Motivo: {p.motivo}</p>}</div>
                  <span className={`px-2 py-0.5 rounded-full font-label-sm uppercase ${ESTADO_PAGO[p.estado].clase}`}>{ESTADO_PAGO[p.estado].texto}</span>
                </li>))}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
