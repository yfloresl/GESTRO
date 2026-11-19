/**
 * ESTANDAR KYROS v1.2 — QR de cobro (web). Copia idéntica en los 7 sistemas (apps/web/src/lib/). Solo depende de React.
 * Dos piezas:
 *  - <SubirQr/>: para quien ADMINISTRA (SuperAdmin de plataforma o administrador del cliente): botón «Subir QR» o arrastrar,
 *    vista previa, campo opcional «Banco», «Reemplazar», «Quitar». Sin URLs ni ajustes técnicos.
 *  - <QrCobro/>: para quien PAGA: muestra el QR; si falta, un aviso claro con la acción «Subir QR» (si puede) o «contacta a quien administra».
 * El sistema solo aporta tres funciones (subir, quitar y, opcional, avisar errores); el componente valida tipo/tamaño antes de enviar y el
 * servidor vuelve a validar por firma (kyros-qr-imagen.ts).
 */
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';

export type IdiomaQr = 'es' | 'en';
export const QR_ACEPTA = 'image/png,image/jpeg,image/webp';
export const QR_MAX_MB = 2;

const T = {
  es: {
    titulo: 'QR de cobro', subir: 'Subir QR', reemplazar: 'Reemplazar', quitar: 'Quitar', guardar: 'Guardar QR', cancelar: 'Cancelar',
    arrastra: 'Arrastra aquí la imagen de tu QR o toca «Subir QR».', formatos: 'PNG, JPG o WebP · máximo 2 MB',
    banco: 'Banco (opcional)', bancoEj: 'Ej.: Banco Unión', vistaPrevia: 'Así se verá', actual: 'QR actual', guardando: 'Guardando…',
    guardado: 'Listo: tu QR ya está activo.', quitado: 'El QR se quitó.', confirmaQuitar: '¿Quitar este QR? Quienes paguen dejarán de verlo.',
    siQuitar: 'Sí, quitar', alt: 'Código QR para pagar', sinQrPuede: 'Todavía no hay un QR de cobro. Sube el tuyo para que puedan pagarte.',
    sinQrNoPuede: 'Todavía no hay un QR de cobro. Contacta a quien administra para que lo suba.',
    respaldo: 'Este QR viene de una configuración anterior. Sube tu QR como archivo para dejarlo definitivo.',
    errTipo: 'Solo se aceptan imágenes PNG, JPG o WebP.', errTamano: 'La imagen pesa más de 2 MB. Usa una captura o foto más liviana.',
    errVacio: 'Elige primero la imagen de tu QR.', errCorrupta: 'No se pudo leer la imagen: está dañada o no es una imagen real.',
    errDimensiones: 'La imagen es muy pequeña o muy grande.', errPermiso: 'No tienes permiso para cambiar este QR. Contacta a quien administra.',
    errGeneral: 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.', soloAdmin: 'Solo quien administra puede cambiar este QR.',
  },
  en: {
    titulo: 'Payment QR', subir: 'Upload QR', reemplazar: 'Replace', quitar: 'Remove', guardar: 'Save QR', cancelar: 'Cancel',
    arrastra: 'Drag your QR image here or tap “Upload QR”.', formatos: 'PNG, JPG or WebP · max 2 MB',
    banco: 'Bank (optional)', bancoEj: 'E.g.: Banco Unión', vistaPrevia: 'How it will look', actual: 'Current QR', guardando: 'Saving…',
    guardado: 'Done: your QR is now active.', quitado: 'The QR was removed.', confirmaQuitar: 'Remove this QR? People paying will no longer see it.',
    siQuitar: 'Yes, remove', alt: 'QR code to pay', sinQrPuede: 'There is no payment QR yet. Upload yours so people can pay you.',
    sinQrNoPuede: 'There is no payment QR yet. Contact whoever administers this account to upload it.',
    respaldo: 'This QR comes from an older setting. Upload your QR as a file to make it permanent.',
    errTipo: 'Only PNG, JPG or WebP images are accepted.', errTamano: 'The image is larger than 2 MB. Use a lighter screenshot or photo.',
    errVacio: 'Choose your QR image first.', errCorrupta: 'The image could not be read: it is damaged or not a real image.',
    errDimensiones: 'The image is too small or too large.', errPermiso: 'You are not allowed to change this QR. Contact whoever administers it.',
    errGeneral: 'Could not save. Check your connection and try again.', soloAdmin: 'Only an administrator can change this QR.',
  },
} as const;
export type TextosQr = { [K in keyof (typeof T)['es']]: string };
export const textosQr = (i?: string): TextosQr => (i === 'en' ? T.en : T.es);

/** Error de subida que el sistema puede lanzar desde `subir`: `codigo` es el de la API (vacio|tamano|tipo|corrupta|dimensiones|permiso). */
export function mensajeErrorQr(e: unknown, idioma?: string): string {
  const x = textosQr(idioma);
  const c = (e as { codigo?: string; code?: string; status?: number } | null) ?? {};
  const codigo = c.codigo ?? c.code;
  if (codigo === 'tipo') return x.errTipo;
  if (codigo === 'tamano') return x.errTamano;
  if (codigo === 'vacio') return x.errVacio;
  if (codigo === 'corrupta') return x.errCorrupta;
  if (codigo === 'dimensiones') return x.errDimensiones;
  if (codigo === 'permiso' || c.status === 401 || c.status === 403) return x.errPermiso;
  if (c.status === 413) return x.errTamano;
  return x.errGeneral;
}

/** Validación previa en el navegador (comodidad: el servidor decide por firma). Devuelve el texto del problema o null. */
export function problemaArchivoQr(f: { type: string; size: number }, idioma?: string): string | null {
  const x = textosQr(idioma);
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return x.errTipo;
  if (f.size > QR_MAX_MB * 1024 * 1024) return x.errTamano;
  if (f.size === 0) return x.errVacio;
  return null;
}

const caja: CSSProperties = { border: '1px solid var(--kx-borde, #cbd5e1)', borderRadius: 8, padding: '14px 16px', background: 'var(--kx-fondo, transparent)' };
const boton: CSSProperties = { cursor: 'pointer', borderRadius: 8, border: '1px solid var(--kx-primario, #1d4ed8)', background: 'var(--kx-primario, #1d4ed8)', color: '#fff', padding: '8px 14px', font: 'inherit' };
const botonSec: CSSProperties = { ...boton, background: 'transparent', color: 'var(--kx-primario, #1d4ed8)' };
const img: CSSProperties = { width: 160, height: 160, objectFit: 'contain', border: '1px solid var(--kx-borde, #cbd5e1)', borderRadius: 8, background: '#fff' };

export interface QrActual { url: string | null; banco?: string | null; /** true si viene de una URL antigua y no de un archivo subido */ esRespaldo?: boolean }

/** Lo que ve quien PAGA. `onSubir` solo si esa persona puede subirlo (aparece el botón «Subir QR» en el aviso). */
export function QrCobro({ qr, idioma, puedeSubir, onSubir, titulo }: { qr: QrActual | null | undefined; idioma?: string; puedeSubir?: boolean; onSubir?: () => void; titulo?: string }) {
  const x = textosQr(idioma);
  if (!qr?.url) {
    return (
      <div role="status" style={caja} data-kx="qr-sin-configurar">
        <p style={{ margin: 0 }}>{puedeSubir ? x.sinQrPuede : x.sinQrNoPuede}</p>
        {puedeSubir && onSubir && <button type="button" style={{ ...boton, marginTop: 10 }} onClick={onSubir}>{x.subir}</button>}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }} data-kx="qr-cobro">
      <img src={qr.url} alt={titulo ?? x.alt} style={img} />
      <div>
        {qr.banco && <strong>{qr.banco}</strong>}
        {qr.esRespaldo && <p style={{ margin: '6px 0 0', fontSize: 13 }}>{puedeSubir ? x.respaldo : ''}</p>}
        {qr.esRespaldo && puedeSubir && onSubir && <button type="button" style={{ ...botonSec, marginTop: 8 }} onClick={onSubir}>{x.subir}</button>}
      </div>
    </div>
  );
}

/**
 * Lo que ve quien ADMINISTRA. `subir(archivo, banco)` y `quitar()` los aporta el sistema (llaman a su API multipart y devuelven una promesa
 * que se rechaza con { codigo } si el servidor rechaza). `alCambiar` sirve para refrescar la pantalla. Sin `puedeEditar` solo muestra el QR.
 */
export function SubirQr({ qr, idioma, puedeEditar = true, subir, quitar, alCambiar, titulo, descripcion }: {
  qr: QrActual | null | undefined; idioma?: string; puedeEditar?: boolean;
  subir: (archivo: File, banco: string) => Promise<unknown>; quitar: () => Promise<unknown>; alCambiar?: () => void; titulo?: string; descripcion?: string;
}) {
  const x = textosQr(idioma);
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [banco, setBanco] = useState(qr?.banco ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [encima, setEncima] = useState(false);

  useEffect(() => { setBanco(qr?.banco ?? ''); }, [qr?.banco]);
  useEffect(() => {
    if (!archivo) { setVista(null); return; }
    const u = URL.createObjectURL(archivo);
    setVista(u);
    return () => URL.revokeObjectURL(u);
  }, [archivo]);

  function elegir(f: File | null | undefined) {
    setOk(null);
    if (!f) return;
    const p = problemaArchivoQr(f, idioma);
    if (p) { setError(p); setArchivo(null); return; }
    setError(null); setArchivo(f);
  }
  function soltar(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setEncima(false); if (puedeEditar) elegir(e.dataTransfer.files?.[0]); }

  async function guardar() {
    if (!archivo) { setError(x.errVacio); return; }
    setOcupado(true); setError(null); setOk(null);
    try { await subir(archivo, banco.trim()); setArchivo(null); setOk(x.guardado); alCambiar?.(); }
    catch (e) { setError(mensajeErrorQr(e, idioma)); }
    finally { setOcupado(false); }
  }
  async function quitarQr() {
    setOcupado(true); setError(null); setOk(null);
    try { await quitar(); setConfirmando(false); setOk(x.quitado); alCambiar?.(); }
    catch (e) { setError(mensajeErrorQr(e, idioma)); }
    finally { setOcupado(false); }
  }

  const tieneQr = !!qr?.url;
  return (
    <section style={caja} data-kx="subir-qr" aria-label={titulo ?? x.titulo}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{titulo ?? x.titulo}</h3>
      {descripcion && <p style={{ margin: '0 0 10px', fontSize: 13 }}>{descripcion}</p>}
      {tieneQr && !archivo && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: '0 0 6px', fontSize: 13 }}>{x.actual}</p>
          <QrCobro qr={qr} idioma={idioma} puedeSubir={puedeEditar} onSubir={() => input.current?.click()} />
        </div>
      )}
      {!puedeEditar ? (
        <p style={{ margin: 0, fontSize: 13 }}>{x.soloAdmin}</p>
      ) : (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)} onDrop={soltar}
            style={{ border: `2px dashed ${encima ? 'var(--kx-primario, #1d4ed8)' : 'var(--kx-borde, #cbd5e1)'}`, borderRadius: 8, padding: 14, textAlign: 'center' }}
          >
            {vista ? (
              <div><p style={{ margin: '0 0 6px', fontSize: 13 }}>{x.vistaPrevia}</p><img src={vista} alt={x.vistaPrevia} style={img} /></div>
            ) : (<p style={{ margin: '0 0 6px' }}>{x.arrastra}</p>)}
            <p style={{ margin: '0 0 8px', fontSize: 12, opacity: 0.8 }}>{x.formatos}</p>
            <input ref={input} type="file" accept={QR_ACEPTA} hidden onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ''; }} data-kx="qr-archivo" />
            <button type="button" style={tieneQr || archivo ? botonSec : boton} disabled={ocupado} onClick={() => input.current?.click()}>
              {tieneQr || archivo ? x.reemplazar : x.subir}
            </button>
          </div>
          <label style={{ display: 'block', marginTop: 10, fontSize: 13 }}>
            {x.banco}
            <input type="text" value={banco} maxLength={60} placeholder={x.bancoEj} onChange={(e) => setBanco(e.target.value)} style={{ display: 'block', width: '100%', maxWidth: 320, padding: 8, borderRadius: 8, border: '1px solid var(--kx-borde, #cbd5e1)', font: 'inherit' }} />
          </label>
          {error && <p role="alert" style={{ margin: '10px 0 0', color: 'var(--kx-error, #dc2626)' }}>{error}</p>}
          {ok && <p role="status" style={{ margin: '10px 0 0' }}>{ok}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {archivo && <button type="button" style={boton} disabled={ocupado} onClick={guardar}>{ocupado ? x.guardando : x.guardar}</button>}
            {archivo && <button type="button" style={botonSec} disabled={ocupado} onClick={() => { setArchivo(null); setError(null); }}>{x.cancelar}</button>}
            {tieneQr && !archivo && !confirmando && <button type="button" style={botonSec} disabled={ocupado} onClick={() => setConfirmando(true)}>{x.quitar}</button>}
          </div>
          {confirmando && (
            <div role="alertdialog" style={{ ...caja, marginTop: 10 }}>
              <p style={{ margin: '0 0 8px' }}>{x.confirmaQuitar}</p>
              <button type="button" style={boton} disabled={ocupado} onClick={quitarQr}>{x.siQuitar}</button>{' '}
              <button type="button" style={botonSec} disabled={ocupado} onClick={() => setConfirmando(false)}>{x.cancelar}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
