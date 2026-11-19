import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SelectorRubro as SelectorRubroComun } from '../lib/kyros-estandar-ui';
import type { RubroActividad } from '../lib/kyros-estandar';
import { useState } from 'react';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { clases } from '../componentes/Marca';

interface Cfg {
  configurada: boolean; sugerencia?: { nit: string; razonSocial: string }; nit?: string; razonSocial?: string; municipio?: string; direccion?: string; leyenda?: string | null;
  permiteConsumidorFinal: boolean; habilitada?: boolean; credencialSinEnviada?: boolean; tokenVenceEn?: string | null; sincronizadaEn?: string | null;
  regimen?: string; avisosRegimen?: string[]; codigosPago?: { efectivo: number; tarjeta: number; otro: number }; codigosConfirmados?: boolean; avisoCodigos?: string | null;
  ultimaPrueba?: { cuando: string; ok: boolean; mensaje: string } | null; aviso?: string | null;
  /** Paso 1: «No incluida en tu plan» + como pedirla. */
  habilitacion?: { habilitada: boolean; mensaje: string | null };
}
interface Paso { id: string; titulo: string; estado: 'ok' | 'error' | 'aviso' | 'omitido'; detalle: string; accion?: string }
interface Resultado { ok: boolean; listo: boolean; resumen: string; pasos: Paso[]; requiereRubro: boolean }
interface RubroSin { actividadEconomica: string; descripcion: string; productosSin: { codigoProductoSin: string; descripcion: string; unidadMedida?: number | null }[] }
interface Rubros { actividades: RubroSin[] }
/** El catálogo de Gestro trae la unidad como número; el estándar la espera como {codigo}. */
const aActividades = (a: RubroSin[]): RubroActividad[] => a.map((x) => ({ ...x, productosSin: x.productosSin.map((p) => ({ ...p, unidadMedida: p.unidadMedida === null || p.unidadMedida === undefined ? null : { codigo: p.unidadMedida } })) }));

/** Aviso permanente mientras la facturación sea simulada. */
export function AvisoPruebas({ texto }: { texto?: string | null }) {
  return <p role="note" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant px-space-sm py-space-xs font-label-md"><span className="material-symbols-outlined align-middle mr-1 text-[18px]" aria-hidden="true">science</span>{texto ?? 'Ambiente de pruebas / sin validez fiscal'}</p>;
}

const NIT = /^\d{5,13}$/;
const SIN_SIMBOLOS = /^[\p{L}\p{M}\p{N} .,;:&()/'"#°ºª@+\-–_%!?¡¿]+$/u;
const campo = (v: string, nombre: string, min: number, max: number): string | null => {
  const t = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (t.length < min) return min <= 1 ? `${nombre} es obligatorio.` : `${nombre}: escribe al menos ${min} caracteres.`;
  if (t.length > max) return `${nombre}: máximo ${max} caracteres.`;
  if (!SIN_SIMBOLOS.test(t)) return `${nombre} tiene caracteres no permitidos (usa letras, números y . , - & ( ) / ' #).`;
  return null;
};

/** Facturación del restaurante a sus comensales (FacturaSIN) en TRES pasos: 1) Facturación (si tu plan la incluye), 2) Datos del SIN, 3) Probar facturación. Solo dueño y administrador. */
export function FacturacionConfig() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fact-config', sucursalId], queryFn: () => api.get<Cfg>('/facturacion/config', sucursalId!), enabled: !!sucursalId });
  const c = q.data;
  if (!c) return <p className="text-on-surface-variant">Cargando facturación…</p>;
  if (c.habilitacion && !c.habilitacion.habilitada) {
    return (
      <p role="status" data-testid="no-incluida" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-md font-body-md">
        <strong>No incluida en tu plan.</strong> {c.habilitacion.mensaje ?? 'Pídela a administracion@kyros-tech.com o mejora tu plan en Suscripción.'}
      </p>
    );
  }
  return <Formulario key={`${c.nit ?? ''}-${c.configurada}`} c={c} refrescar={() => qc.invalidateQueries({ queryKey: ['fact-config', sucursalId] })} />;
}

/** S-13: «Rubro del negocio» como lista simple (siempre visible) que completa actividad + producto del SIN; «Avanzado» muestra los tres códigos. Solo catálogo sincronizado: nada se inventa. */
function SelectorRubro({ onElegido }: { onElegido(): void }) {
  const { sucursalId } = useRolesActivos();
  const r = useQuery({ queryKey: ['fact-rubros', sucursalId], queryFn: () => api.get<Rubros>('/facturacion/rubros', sucursalId!), enabled: !!sucursalId });
  const [sel, setSel] = useState(''); const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    const [actividadEconomica, codigoProductoSin] = sel.split('|'); setError(null);
    try { await api.put('/facturacion/rubro', { actividadEconomica, codigoProductoSin }, sucursalId!); onElegido(); } catch (e) { setError(mensajeDeError(e)); }
  };
  return (
    <div className="flex flex-col gap-space-sm" data-testid="selector-rubro">
      <SelectorRubroComun actividades={aActividades(r.data?.actividades ?? [])} valor={sel} onCambio={setSel} catalogoDisponible={!r.isError} />
      <button type="button" disabled={!sel} onClick={() => void guardar()} className={clases.secundario}>Guardar rubro</button>
      {error && <p role="alert" className="text-error font-body-sm">{error}</p>}
    </div>
  );
}

function Formulario({ c, refrescar }: { c: Cfg; refrescar(): Promise<unknown> }) {
  const { sucursalId } = useRolesActivos();
  const [nit, setNit] = useState(c.nit ?? c.sugerencia?.nit ?? ''); const [razon, setRazon] = useState(c.razonSocial ?? c.sugerencia?.razonSocial ?? '');
  const [muni, setMuni] = useState(c.municipio ?? ''); const [dir, setDir] = useState(c.direccion ?? ''); const [ley, setLey] = useState(c.leyenda ?? '');
  const [codigoSistema, setCodigoSistema] = useState('');
  const [regimen, setRegimen] = useState(c.regimen ?? 'no_declarado'); const [pagoOtro, setPagoOtro] = useState(String(c.codigosPago?.otro ?? 7)); const [confirmados, setConfirmados] = useState(c.codigosConfirmados === true);
  const [final, setFinal] = useState(c.permiteConsumidorFinal);
  const [token, setToken] = useState(''); const [vence, setVence] = useState(c.tokenVenceEn ?? '');
  const [errores, setErrores] = useState<Record<string, string>>({}); const [aviso, setAviso] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Resultado | null>(null); const [ocupado, setOcupado] = useState<string | null>(null);

  const validar = () => {
    const e: Record<string, string> = {};
    if (!NIT.test(nit.trim())) e.nit = 'El NIT son solo números, de 5 a 13 dígitos, sin guiones ni espacios.';
    const r = campo(razon, 'La razón social', 2, 200); if (r) e.razon = r;
    const m = campo(muni, 'El municipio', 2, 100); if (m) e.muni = m;
    const d = campo(dir, 'La dirección', 3, 300); if (d) e.dir = d;
    if (ley.trim()) { const l = campo(ley, 'La leyenda', 3, 300); if (l) e.ley = l; }
    if ((token.trim() || codigoSistema.trim()) && (token.trim().length < 10 || codigoSistema.trim().length < 3)) e.token = 'Para cargar las credenciales del SIN escribe el código de sistema y el token delegado completos.';
    if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) e.vence = 'Fecha AAAA-MM-DD.';
    setErrores(e); return e;
  };

  /** Paso 2: solo los datos y credenciales que da el SIN; la empresa se crea sola en FacturaSIN. */
  const guardar = async () => {
    setError(null); setAviso(null); if (Object.keys(validar()).length) return false;
    setOcupado('guardar');
    try {
      const r = await api.put<{ sincronizada?: boolean; mensaje?: string }>('/facturacion/config', {
        nit: nit.trim(), razonSocial: razon, municipio: muni, direccion: dir, leyenda: ley.trim() || null, permiteConsumidorFinal: final, habilitada: true, regimen,
        codigosPago: { efectivo: c.codigosPago?.efectivo ?? 1, tarjeta: c.codigosPago?.tarjeta ?? 2, otro: Number(pagoOtro) || 7 }, codigosConfirmados: confirmados,
        ...(codigoSistema.trim() && token.trim() ? { codigoSistema: codigoSistema.trim(), tokenDelegado: token.trim() } : {}), ...(vence ? { tokenVenceEn: vence } : {}),
      }, sucursalId!);
      setToken(''); setCodigoSistema(''); setAviso(r.mensaje ?? 'Guardado.'); await refrescar(); return true;
    } catch (err) { setError(mensajeDeError(err)); return false; } finally { setOcupado(null); }
  };
  /** Paso 3: valida todo de punta a punta y lo dice en lenguaje simple. */
  const probar = async () => {
    setRes(null); setError(null);
    if (!(await guardar())) return;
    setOcupado('probar');
    try { setRes(await api.post<Resultado>('/facturacion/probar', undefined, sucursalId!)); await refrescar(); }
    catch (err) { setError(mensajeDeError(err)); } finally { setOcupado(null); }
  };
  const campoVista = (id: string, etiqueta: string, valor: string, cambiar: (v: string) => void, extra: { ayuda?: string; modo?: 'numeric' | 'text'; tipo?: string; max?: number } = {}) => (
    <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>{etiqueta}</span>
      <input value={valor} onChange={(e) => { cambiar(e.target.value); setAviso(null); }} inputMode={extra.modo} type={extra.tipo ?? 'text'} maxLength={extra.max} aria-invalid={!!errores[id]} aria-describedby={`${id}-ayuda`} autoComplete="off" className={clases.input} />
      {errores[id] ? <span id={`${id}-ayuda`} role="alert" className="text-error font-body-sm">{errores[id]}</span> : extra.ayuda ? <span id={`${id}-ayuda`} className="font-body-sm text-on-surface-variant">{extra.ayuda}</span> : null}
    </label>
  );

  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-md" aria-labelledby="fact-titulo">
      <div>
        <h2 id="fact-titulo" className="font-headline-sm text-headline-sm text-primary">Facturación electrónica a tus clientes</h2>
        <p className="font-body-sm text-on-surface-variant">Tres pasos: 1) Facturación (incluida en tu plan), 2) Datos del SIN, 3) Probar facturación. Todo lo demás es automático. Hoy todo funciona en un ambiente de pruebas: ninguna factura tiene validez fiscal.</p>
      </div>
      <AvisoPruebas texto={c.aviso} />
      {c.avisoCodigos && !confirmados && <p role="note" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm font-label-md">{c.avisoCodigos}</p>}
      {(c.avisosRegimen ?? []).map((a) => <p key={a} role="note" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed-variant p-space-sm font-body-sm">{a}</p>)}
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <h3 className="font-label-md font-bold">Paso 2 · Datos del SIN</h3>
      <div className="grid sm:grid-cols-2 gap-space-sm">
        {campoVista('nit', 'NIT del restaurante', nit, setNit, { modo: 'numeric', max: 13, ayuda: 'Solo números. En pruebas usa un NIT ficticio, por ejemplo 1000000005.' })}
        {campoVista('razon', 'Razón social', razon, setRazon, { max: 200 })}
        {campoVista('muni', 'Municipio', muni, setMuni, { max: 100 })}
        {campoVista('dir', 'Dirección', dir, setDir, { max: 300 })}
        {campoVista('codigo', 'Código de sistema del SIN', codigoSistema, setCodigoSistema, { max: 100, ayuda: 'Te lo da el SIN al registrar tu sistema de facturación. Se envía a FacturaSIN y no se guarda aquí.' })}
        {campoVista('token', c.credencialSinEnviada ? 'Reemplazar token delegado (opcional)' : 'Token delegado del SIN', token, setToken, { tipo: 'password', max: 4000, ayuda: 'Se envía a FacturaSIN (cifrado allá) y no se guarda en GESTRO.' })}
      </div>
      <details className="rounded-lg border border-outline-variant p-space-sm" data-testid="avanzado-emisor">
        <summary className="cursor-pointer font-label-md font-bold">Avanzado</summary>
        <div className="grid sm:grid-cols-2 gap-space-sm mt-space-sm">
          {campoVista('ley', 'Leyenda (opcional)', ley, setLey, { max: 300, ayuda: 'Mensaje propio que se muestra junto a la factura. La leyenda legal la agrega el SIN.' })}
          {campoVista('vence', 'El token vence el (AAAA-MM-DD)', vence, setVence, { max: 10 })}
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Régimen tributario</span><select value={regimen} onChange={(e) => { setRegimen(e.target.value); setAviso(null); }} className={clases.input}><option value="no_declarado">No lo sé / prefiero no indicarlo</option><option value="general">Régimen General</option><option value="simplificado">Régimen Tributario Simplificado</option></select></label>
          {campoVista('pago', 'Código SIN de «otro medio de pago» (QR, transferencia)', pagoOtro, setPagoOtro, { modo: 'numeric', max: 3, ayuda: 'Efectivo = 1 y tarjeta = 2 están confirmados; el de QR/transferencia sale del catálogo metodoPago.' })}
          <label className="flex items-center gap-space-sm sm:col-span-2"><input type="checkbox" checked={confirmados} onChange={(e) => { setConfirmados(e.target.checked); setAviso(null); }} /><span className="font-body-sm">Mi contador confirmó los códigos con el catálogo sincronizado.</span></label>
          <label className="flex items-center gap-space-sm sm:col-span-2 min-h-11"><input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} className="w-5 h-5" /><span>Permitir factura «sin nombre» (consumidor final)</span></label>
        </div>
      </details>
      <div className="grid sm:grid-cols-2 gap-space-sm">
        <button type="button" disabled={!!ocupado} onClick={() => void guardar()} className={clases.primario}>{ocupado === 'guardar' ? 'Guardando…' : 'Guardar datos del SIN'}</button>
      </div>
      {aviso && <p role="status" className="text-primary font-body-sm">{aviso}</p>}
      <h3 className="font-label-md font-bold">Paso 3 · Probar facturación</h3>
      <button type="button" disabled={!!ocupado} onClick={() => void probar()} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>{ocupado === 'probar' ? 'Probando…' : 'Probar facturación'}</button>
      {res && <p role="status" className={`rounded-lg p-space-sm font-label-md ${res.listo ? 'bg-primary-fixed text-on-surface' : 'bg-secondary-fixed text-on-secondary-fixed-variant'}`}>{res.resumen}</p>}
      {res && res.pasos.length > 0 && <ul aria-live="polite" className="flex flex-col gap-1">{res.pasos.map((p) => <li key={p.id} className={`rounded-lg px-space-sm py-space-xs ${p.estado === 'error' ? 'bg-error-container text-on-error-container' : 'bg-primary-fixed text-on-surface'}`}><strong>{p.estado === 'ok' ? '✓' : p.estado === 'error' ? '✗' : '•'} {p.titulo}:</strong> {p.detalle}{p.accion ? ` (${p.accion})` : ''}</li>)}</ul>}
      <SelectorRubro onElegido={() => { if (res?.requiereRubro) void probar(); }} />
      <p className="font-body-sm text-on-surface-variant">{c.ultimaPrueba ? `Última prueba: ${new Date(c.ultimaPrueba.cuando).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })} · ${c.ultimaPrueba.ok ? 'correcta' : c.ultimaPrueba.mensaje}` : 'Aún no se ha probado.'}</p>
    </section>
  );
}
