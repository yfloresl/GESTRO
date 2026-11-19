/** ESTANDAR KYROS v1.1: prueba mínima de cada componente/regla común (vitest + react-dom/server, sin dependencias extra). */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup as h } from 'react-dom/server';
import { SESION_MAX_AGE_S, REAUTH_SENSIBLE_MAX_AGE_S, parametrosIngreso, identidadReciente, requiereReconfirmar, rutaCanonicaPlataforma, etiquetaEstado, aLenguajeSimple, mensajeLegible, diasParaVencer, opcionesRubro, textos, rutaInicioPlataforma, desgloseIva, desgloseCambioPlan, textoIvaIncluido, REDIRECCIONES_PLATAFORMA, esAdminPlataforma, textoFuncionalidadesSinPrecio } from './kyros-estandar';
import { calcularProrrateo } from './kyros-prorrateo-plan';
import { BotonEntrarKyrosId, AvisoReconfirmar, SinPermiso, AceptacionLegal, AvisoDemostracion, InvitacionEnlace, VistaPreviaCambioPlan, FuncionalidadesSinPrecio, SelectorRubro, ListaAvisos, MenuPlataforma } from './kyros-estandar-ui';

const r0 = calcularProrrateo({ hoy: '2026-11-10', vigenciaHasta: '2026-11-30', centavosActual: 30000, centavosNuevo: 60000 });

describe('estandar Kyros: lógica', () => {
  it('S-03 sesión: 8 h normal, 5 min sensible, forzado configurable', () => {
    expect(SESION_MAX_AGE_S).toBe(28800); expect(REAUTH_SENSIBLE_MAX_AGE_S).toBe(300);
    expect(parametrosIngreso('normal', false)).toEqual({ max_age: '28800' });
    expect(parametrosIngreso('sensible', false)).toEqual({ max_age: '300' });
    expect(parametrosIngreso('normal', true)).toEqual({ prompt: 'login', max_age: '0' });
    expect(identidadReciente(1000, 1299)).toBe(true); expect(identidadReciente(1000, 1301)).toBe(false); expect(identidadReciente(null)).toBe(false);
    expect(requiereReconfirmar({ codigo: 'REAUTH_REQUERIDA' })).toBe(true); expect(requiereReconfirmar({ message: 'otro' })).toBe(false);
  });
  it('S-04/S-05 rutas y glosario', () => {
    expect(rutaCanonicaPlataforma('/admin/')).toBe('/plataforma'); expect(rutaCanonicaPlataforma('/app/plataforma')).toBe('/plataforma'); expect(rutaCanonicaPlataforma('/otra')).toBeNull();
    expect(etiquetaEstado('validada')).toBe('Emitida'); expect(aLenguajeSimple('Webhook del backoffice')).toBe('aviso de estados del Plataforma');
  });
  it('S-07 errores legibles', () => {
    expect(mensajeLegible(new Error('Failed to fetch'))).toMatch(/No pudimos/); expect(mensajeLegible({ message: 'Falta el NIT' })).toBe('Falta el NIT');
    expect(mensajeLegible({ codigo: 'SESION_ANTIGUA' })).toMatch(/Confirmar mi identidad/);
  });
  it('S-08/S-13/S-06b helpers', () => {
    const ahora = new Date('2026-01-01T00:00:00Z');
    expect(diasParaVencer('2026-01-04T00:00:00Z', ahora)).toBe(3); expect(diasParaVencer('2025-12-31T00:00:00Z', ahora)).toBe(0);
    expect(opcionesRubro([{ actividadEconomica: '620100', descripcion: 'Software', productosSin: [{ codigoProductoSin: '83141', descripcion: 'Licencias' }] }])[0]!.valor).toBe('620100|83141');
    expect(esAdminPlataforma(['SuperAdmin'])).toBe(true); expect(esAdminPlataforma(['paciente'])).toBe(false);
    expect(textoFuncionalidadesSinPrecio([])).toMatch(/Todas/);
  });
});

describe('estandar Kyros: componentes', () => {
  it('textos y botones únicos', () => {
    expect(h(<BotonEntrarKyrosId onClick={() => {}} />)).toContain('Entrar con Kyros ID');
    expect(h(<AvisoReconfirmar onConfirmar={() => {}} />)).toContain('Confirmar mi identidad');
    expect(h(<SinPermiso />)).toContain('No tienes permiso para ver esto');
    expect(h(<AvisoDemostracion />)).toContain('Demostración');
  });
  it('S-07 casilla: sin marcar tras intentar muestra el mensaje', () => {
    expect(h(<AceptacionLegal marcada={false} intento onCambio={() => {}}>los términos</AceptacionLegal>)).toContain('Marca la casilla para continuar');
    expect(h(<AceptacionLegal marcada={false} intento={false} onCambio={() => {}}>los términos</AceptacionLegal>)).not.toContain('Marca la casilla');
    expect(h(<AceptacionLegal marcada intento onCambio={() => {}}>los términos</AceptacionLegal>)).not.toContain('Marca la casilla');
  });
  it('S-08 invitación y S-06 vista previa', () => {
    const futuro = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(h(<InvitacionEnlace enlace="https://x/y" venceEn={futuro} onReenviar={() => {}} />)).toMatch(/Vence en [34] días[\s\S]*Reenviar invitación/);
    expect(h(<InvitacionEnlace enlace="https://x/y" venceEn={null} />)).toContain('Vencida');
    const r = calcularProrrateo({ hoy: '2026-11-10', vigenciaHasta: '2026-11-30', centavosActual: 30000, centavosNuevo: 60000 });
    const html = h(<VistaPreviaCambioPlan r={r} planActual="Básico" planNuevo="Pro" fmt={(c) => `Bs ${(c / 100).toFixed(2)}`} />);
    expect(html).toContain('Crédito'); expect(html).toContain('No pierdes días'); expect(r.cobroCentavos).toBeGreaterThan(0);
  });
  it('S-06b, S-13, S-12, S-04', () => {
    expect(h(<FuncionalidadesSinPrecio items={[{ clave: 'a', nombre: 'Agenda' }]} />)).toContain('Agenda');
    expect(h(<SelectorRubro actividades={[{ actividadEconomica: '1', descripcion: 'A', productosSin: [{ codigoProductoSin: '2', descripcion: 'P' }] }]} valor="" onCambio={() => {}} />)).toContain('Avanzado');
    expect(h(<ListaAvisos items={[]} />)).toContain('No tienes avisos nuevos.');
    expect(h(<MenuPlataforma renderEnlace={(s) => s.etiqueta} />)).toMatch(/Clientes[\s\S]*Planes[\s\S]*Facturación[\s\S]*Integraciones[\s\S]*Auditoría[\s\S]*Demostración/);
  });
});

describe('estandar Kyros: arreglos v1.1', () => {
  it('(1) etiquetas parametrizables de la vista previa', () => {
    expect(h(<VistaPreviaCambioPlan r={r0} planActual="A" planNuevo="B" fmt={(c) => String(c)} etiquetas={{ aPagar: 'Total hoy' }} />)).toContain('Total hoy');
    expect(h(<VistaPreviaCambioPlan r={r0} planActual="A" planNuevo="B" fmt={(c) => String(c)} idioma="en" />)).toContain('To pay now');
  });
  it('(2) español, inglés y portugués', () => {
    expect(h(<AceptacionLegal marcada={false} intento idioma="en" onCambio={() => {}}>x</AceptacionLegal>)).toContain('Tick the box to continue');
    expect(h(<AceptacionLegal marcada={false} intento idioma="pt" onCambio={() => {}}>x</AceptacionLegal>)).toContain('Marque a caixa para continuar');
    expect(h(<InvitacionEnlace enlace="u" venceEn={null} idioma="en" />)).toContain('Expired');
    expect(h(<ListaAvisos items={[]} idioma="pt" />)).toContain('Você não tem avisos novos.');
    expect(textos('xx').entrarKyrosId).toBe('Entrar con Kyros ID'); expect(textos('en').invitacionVigencia(1)).toBe('Expires tomorrow');
  });
  it('(3) PLATAFORMA_REAUTH pide reconfirmar', () => { expect(requiereReconfirmar({ codigo: 'PLATAFORMA_REAUTH' })).toBe(true); });
  it('(4) el selector muestra la unidad de medida', () => {
    const a = [{ actividadEconomica: '1', descripcion: 'A', productosSin: [{ codigoProductoSin: '2', descripcion: 'P', unidadMedida: { codigo: 58, descripcion: 'Unidad (servicios)' } }, { codigoProductoSin: '3', descripcion: 'Q' }] }];
    expect(opcionesRubro(a)[0]!.unidadMedida).toBe('Unidad (servicios) (58)'); expect(opcionesRubro(a)[1]!.unidadMedida).toBe('NO CONFIRMADO');
    expect(h(<SelectorRubro actividades={a} valor="1|2" onCambio={() => {}} />)).toContain('Unidad de medida: Unidad (servicios) (58)');
  });
  it('(5) /plataforma no se redirige a sí misma', () => {
    expect(rutaCanonicaPlataforma('/plataforma')).toBeNull(); expect(rutaInicioPlataforma(['planes'])).toBe('/plataforma/planes'); expect(rutaInicioPlataforma()).toBe('/plataforma/clientes');
    for (const [o, d] of Object.entries(REDIRECCIONES_PLATAFORMA)) expect(o).not.toBe(d);
  });
  it('(6) el menú filtra por rol', () => {
    const rr = (s: { etiqueta: string }) => s.etiqueta;
    expect(h(<MenuPlataforma roles={['paciente']} renderEnlace={rr} />)).toBe('');
    expect(h(<MenuPlataforma roles={['SuperAdmin']} puede={(c) => c !== 'planes'} renderEnlace={rr} />)).not.toContain('Planes');
    expect(h(<MenuPlataforma roles={['SuperAdmin']} renderEnlace={rr} />)).toContain('Auditoría');
  });
});

describe('estandar Kyros: IVA desglosado (S-06)', () => {
  /** Recálculo independiente en BigInt: iva = round_half_up(total × 13 / 100). */
  const ivaRef = (t: bigint): bigint => { const q = t * 13n; const d = q / 100n; return q % 100n >= 50n ? d + 1n : d; };
  it('ejemplo del proyecto: Bs 800,00 → IVA 104,00 y neto 696,00', () => {
    expect(desgloseIva(80000)).toEqual({ netoCentavos: 69600, ivaCentavos: 10400, totalCentavos: 80000 });
  });
  it('bordes de redondeo: 0, 1 centavo, impares, mitades y totales grandes cuadran contra BigInt', () => {
    const casos = [0, 1, 2, 3, 4, 7, 8, 9, 11, 15, 49, 50, 51, 99, 101, 333, 3846, 3847, 10001, 99999, 123457, 80001, 2 ** 31 + 1, 9_000_000_000_000];
    for (const c of casos) {
      const d = desgloseIva(c);
      expect(BigInt(d.ivaCentavos)).toBe(ivaRef(BigInt(c)));
      expect(d.netoCentavos + d.ivaCentavos).toBe(c);
      expect(d.netoCentavos).toBeGreaterThanOrEqual(0);
    }
    for (let c = 0; c < 2000; c++) expect(BigInt(desgloseIva(c).ivaCentavos)).toBe(ivaRef(BigInt(c)));
  });
  it('rechaza importes no enteros o negativos', () => { expect(() => desgloseIva(1.5)).toThrow(RangeError); expect(() => desgloseIva(-1)).toThrow(RangeError); });
  it('desglose del cambio de plan: cada importe cuadra y el total no cambia', () => {
    const rs = [r0, calcularProrrateo({ hoy: '2026-11-10', vigenciaHasta: '2026-11-30', centavosActual: 60000, centavosNuevo: 30000, saldoPrevioCentavos: 777 })];
    for (const r of rs) {
      const d = desgloseCambioPlan(r);
      for (const k of ['credito', 'costoNuevo', 'saldoAplicado', 'cobro', 'saldoFinal'] as const) expect(d[k].netoCentavos + d[k].ivaCentavos).toBe(d[k].totalCentavos);
      expect(d.cobro.totalCentavos).toBe(r.cobroCentavos); expect(d.credito.totalCentavos).toBe(r.creditoCentavos); expect(d.costoNuevo.totalCentavos).toBe(r.costoNuevoCentavos);
      expect(d.diferencia.totalCentavos).toBe(Math.abs(r.diferenciaCentavos));
    }
  });
  it('la vista previa muestra Neto / IVA 13 % / Total y «IVA 13 % incluido»', () => {
    const html = h(<VistaPreviaCambioPlan r={r0} planActual="A" planNuevo="B" fmt={(c) => 'Bs ' + (c / 100).toFixed(2)} />);
    expect(html).toContain('Neto'); expect(html).toContain('IVA 13 %'); expect(html).toContain('IVA 13 % incluido:'); expect(html).toContain('Total');
    expect(textoIvaIncluido(80000, (c) => 'Bs ' + (c / 100).toFixed(2))).toBe('IVA 13 % incluido: Bs 104.00');
  });
});
