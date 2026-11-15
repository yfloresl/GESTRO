import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { clases } from '../componentes/Marca';

interface Cfg {
  configurada: boolean; nit?: string; razonSocial?: string; actividades?: string[]; sucursal: number; puntoVenta: number; municipio?: string; direccion?: string; leyenda?: string | null;
  modalidad: string; codigoSinPorDefecto?: string; unidadPorDefecto: number; permiteConsumidorFinal: boolean; habilitada: boolean; tokenRegistrado?: boolean; tokenVenceEn?: string | null; webhookRegistrado?: boolean;
  conectadoEn?: string | null; ultimaPrueba?: { cuando: string; ok: boolean; mensaje: string } | null; aviso: string | null; ambientePruebas: boolean; sugerencia?: { nit: string; razonSocial: string };
}
interface Paso { paso: string; ok: boolean; detalle: string }

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

/** Configuración de la facturación del restaurante a sus comensales (FacturaSIN). Solo dueño y administrador. */
export function FacturacionConfig() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fact-config', sucursalId], queryFn: () => api.get<Cfg>('/facturacion/config', sucursalId!), enabled: !!sucursalId });
  const c = q.data;
  if (!c) return <p className="text-on-surface-variant">Cargando facturación…</p>;
  return <Formulario key={`${c.nit ?? ''}-${c.configurada}`} c={c} refrescar={() => qc.invalidateQueries({ queryKey: ['fact-config', sucursalId] })} />;
}

function Formulario({ c, refrescar }: { c: Cfg; refrescar(): Promise<unknown> }) {
  const { sucursalId } = useRolesActivos();
  const [nit, setNit] = useState(c.nit ?? c.sugerencia?.nit ?? ''); const [razon, setRazon] = useState(c.razonSocial ?? c.sugerencia?.razonSocial ?? '');
  const [act, setAct] = useState((c.actividades ?? []).join(', ')); const [suc, setSuc] = useState(String(c.sucursal)); const [pv, setPv] = useState(String(c.puntoVenta));
  const [muni, setMuni] = useState(c.municipio ?? ''); const [dir, setDir] = useState(c.direccion ?? ''); const [ley, setLey] = useState(c.leyenda ?? '');
  const [codSin, setCodSin] = useState(c.codigoSinPorDefecto ?? ''); const [uni, setUni] = useState(String(c.unidadPorDefecto));
  const [final, setFinal] = useState(c.permiteConsumidorFinal); const [hab, setHab] = useState(c.habilitada);
  const [token, setToken] = useState(''); const [vence, setVence] = useState(c.tokenVenceEn ?? '');
  const [errores, setErrores] = useState<Record<string, string>>({}); const [aviso, setAviso] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [pasos, setPasos] = useState<Paso[] | null>(null); const [ocupado, setOcupado] = useState<string | null>(null);

  const validar = () => {
    const e: Record<string, string> = {};
    if (!NIT.test(nit.trim())) e.nit = 'El NIT son solo números, de 5 a 13 dígitos, sin guiones ni espacios.';
    const r = campo(razon, 'La razón social', 2, 200); if (r) e.razon = r;
    const m = campo(muni, 'El municipio', 2, 100); if (m) e.muni = m;
    const d = campo(dir, 'La dirección', 3, 300); if (d) e.dir = d;
    if (ley.trim()) { const l = campo(ley, 'La leyenda', 3, 300); if (l) e.ley = l; }
    const acts = act.split(/[,\s]+/).filter(Boolean);
    if (!acts.length || acts.some((a) => !/^\d{4,8}$/.test(a))) e.act = 'Escribe uno o más códigos de actividad económica del SIN (solo números), separados por coma.';
    if (!/^\d{3,10}$/.test(codSin.trim())) e.cod = 'El código de producto SIN son 3 a 10 dígitos.';
    if (!/^\d{1,3}$/.test(uni.trim()) || Number(uni) < 1) e.uni = 'La unidad de medida es un número del catálogo SIN (por ejemplo 57).';
    if (!/^\d{1,4}$/.test(suc.trim())) e.suc = 'Número de sucursal: 0 o más.';
    if (!/^\d{1,4}$/.test(pv.trim())) e.pv = 'Número de punto de venta: 0 o más.';
    if (token.trim() && token.trim().length < 10) e.token = 'El token delegado parece incompleto.';
    if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) e.vence = 'Fecha AAAA-MM-DD.';
    setErrores(e); return { e, acts };
  };

  const guardar = async (extra: Record<string, unknown> = {}) => {
    setError(null); setAviso(null); const { e, acts } = validar(); if (Object.keys(e).length) return false;
    setOcupado('guardar');
    try {
      await api.put('/facturacion/config', {
        nit: nit.trim(), razonSocial: razon, actividades: acts, sucursal: Number(suc), puntoVenta: Number(pv), municipio: muni, direccion: dir, leyenda: ley.trim() || null, modalidad: 'simulado',
        codigoSinPorDefecto: codSin.trim(), unidadPorDefecto: Number(uni), permiteConsumidorFinal: final, habilitada: hab, ...(token.trim() ? { tokenDelegado: token.trim() } : {}), ...(vence ? { tokenVenceEn: vence } : {}), ...extra,
      }, sucursalId!);
      setToken(''); setAviso('Guardado.'); await refrescar(); return true;
    } catch (err) { setError(mensajeDeError(err)); return false; } finally { setOcupado(null); }
  };
  const accion = async (ruta: 'probar' | 'conectar') => {
    setPasos(null); setError(null);
    if (!(await guardar())) return;
    setOcupado(ruta);
    try { const r = await api.post<{ ok: boolean; pasos: Paso[] }>(`/facturacion/${ruta}`, undefined, sucursalId!); setPasos(r.pasos); await refrescar(); }
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
        <p className="font-body-sm text-on-surface-variant">Con estos datos GESTRO pide la factura de cada venta a FacturaSIN, a nombre de tu restaurante. Hoy todo funciona en un ambiente de pruebas: ninguna factura tiene validez fiscal.</p>
      </div>
      <AvisoPruebas texto={c.aviso} />
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      <div className="grid sm:grid-cols-2 gap-space-sm">
        {campoVista('nit', 'NIT del restaurante', nit, setNit, { modo: 'numeric', max: 13, ayuda: 'Solo números. En pruebas usa un NIT ficticio, por ejemplo 1000000005.' })}
        {campoVista('razon', 'Razón social', razon, setRazon, { max: 200 })}
        {campoVista('act', 'Actividad económica (códigos SIN)', act, setAct, { ayuda: 'Uno o varios, separados por coma. El primero es el principal.' })}
        {campoVista('muni', 'Municipio', muni, setMuni, { max: 100 })}
        <div className="sm:col-span-2">{campoVista('dir', 'Dirección', dir, setDir, { max: 300 })}</div>
        {campoVista('suc', 'Sucursal SIN', suc, setSuc, { modo: 'numeric', max: 4, ayuda: '0 = casa matriz.' })}
        {campoVista('pv', 'Punto de venta SIN', pv, setPv, { modo: 'numeric', max: 4, ayuda: '0 = primer punto de venta.' })}
        {campoVista('cod', 'Código de producto SIN por defecto', codSin, setCodSin, { modo: 'numeric', max: 10, ayuda: 'Se usa en los platos sin código propio (se pone en Menú).' })}
        {campoVista('uni', 'Unidad de medida por defecto', uni, setUni, { modo: 'numeric', max: 3, ayuda: 'Catálogo SIN: 57 = unidad (bienes), 58 = unidad (servicios).' })}
        <div className="sm:col-span-2">{campoVista('ley', 'Leyenda (opcional)', ley, setLey, { max: 300, ayuda: 'Mensaje propio que se muestra junto a la factura. La leyenda legal la agrega el SIN.' })}</div>
      </div>
      <div className="grid sm:grid-cols-2 gap-space-sm">
        <div><span className={clases.etiqueta}>Modalidad</span><p className="h-[52px] flex items-center rounded-lg bg-surface-container px-space-md">Simulado (pruebas)</p><p className="font-body-sm text-on-surface-variant">La modalidad real se habilita cuando el SIN autorice el sistema.</p></div>
        <div className="flex flex-col gap-space-xs">
          <label className="flex items-center gap-space-sm min-h-11"><input type="checkbox" checked={hab} onChange={(e) => setHab(e.target.checked)} className="w-5 h-5" /><span>Facturar en Caja (encendido)</span></label>
          <label className="flex items-center gap-space-sm min-h-11"><input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} className="w-5 h-5" /><span>Permitir factura «sin nombre» (consumidor final)</span></label>
        </div>
      </div>
      <fieldset className="rounded-lg border border-outline-variant p-space-sm flex flex-col gap-space-sm">
        <legend className={`${clases.etiqueta} px-1`}>Credencial del emisor (token delegado del SIN)</legend>
        <p className="font-body-sm text-on-surface-variant">{c.tokenRegistrado ? 'Hay un token guardado, cifrado. Por seguridad no se puede ver; pega uno nuevo solo si quieres reemplazarlo.' : 'Aún no hay token. En pruebas no es obligatorio.'}</p>
        <div className="grid sm:grid-cols-2 gap-space-sm">
          {campoVista('token', c.tokenRegistrado ? 'Reemplazar token (opcional)' : 'Token delegado', token, setToken, { tipo: 'password', max: 4000 })}
          {campoVista('vence', 'Vence el (AAAA-MM-DD)', vence, setVence, { max: 10 })}
        </div>
        {c.tokenRegistrado && <button type="button" onClick={() => guardar({ quitarToken: true })} className="self-start h-11 px-space-sm text-error font-label-md">Quitar el token guardado</button>}
      </fieldset>
      <div className="grid sm:grid-cols-3 gap-space-sm">
        <button type="button" disabled={!!ocupado} onClick={() => void guardar()} className={clases.primario}>{ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" disabled={!!ocupado} onClick={() => void accion('probar')} className={clases.secundario}>{ocupado === 'probar' ? 'Probando…' : 'Probar conexión'}</button>
        <button type="button" disabled={!!ocupado} onClick={() => void accion('conectar')} className={clases.secundario}>{ocupado === 'conectar' ? 'Conectando…' : 'Conectar con FacturaSIN'}</button>
      </div>
      {aviso && <p role="status" className="text-primary font-body-sm">{aviso}</p>}
      {pasos && <ul aria-live="polite" className="flex flex-col gap-1">{pasos.map((p) => <li key={p.paso} className={`rounded-lg px-space-sm py-space-xs ${p.ok ? 'bg-primary-fixed text-on-surface' : 'bg-error-container text-on-error-container'}`}><strong>{p.ok ? '✔' : '✖'} {p.paso}.</strong> {p.detalle}</li>)}</ul>}
      <p className="font-body-sm text-on-surface-variant">{c.ultimaPrueba ? `Última prueba: ${new Date(c.ultimaPrueba.cuando).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })} · ${c.ultimaPrueba.ok ? 'correcta' : c.ultimaPrueba.mensaje}.` : 'Todavía no se ha probado la conexión.'}{c.conectadoEn ? ` Conectado el ${new Date(c.conectadoEn).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz' })}.` : ''}</p>
    </section>
  );
}
