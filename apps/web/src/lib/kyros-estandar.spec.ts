import { describe, expect, it } from 'vitest';
import {
  ALIAS_NOTIFICACIONES, autenticacionReciente, calcularProrrateo, enmascarar, funcionalidadesSinPrecio, lineasVistaPrevia, mensajeErrorAceptacion, opcionesDeRubro,
  parametrosSesion, PLATAFORMA_SECCIONES, redirigirRutaVieja, resumenCodigosFiscales, seccionDePlataforma, SESION, simplificarTexto, validarAceptacion, vigenciaInvitacion,
  vistaPreviaDeProrrateo,
} from './kyros-estandar';

describe('estandar Kyros de simplificacion', () => {
  it('S-03: ingreso 28800 s sin prompt=login; accion sensible <= 300 s con prompt=login', () => {
    expect(parametrosSesion('ingreso')).toEqual({ maxAge: 28800, promptLogin: false });
    expect(parametrosSesion('ingreso', { loginMaxAge: 3600 })).toEqual({ maxAge: 3600, promptLogin: false });
    expect(parametrosSesion('ingreso', { loginMaxAge: -5 }).maxAge).toBe(28800);
    expect(parametrosSesion('sensible')).toEqual({ maxAge: 300, promptLogin: true });
    expect(SESION.BOTON_RECONFIRMAR).toBe('Confirmar mi identidad');
    expect(autenticacionReciente(1000, 1200)).toBe(true);
    expect(autenticacionReciente(1000, 1500)).toBe(false);
    expect(autenticacionReciente(null)).toBe(false);
  });
  it('S-04: seis secciones y redireccion de rutas viejas', () => {
    expect(PLATAFORMA_SECCIONES.map((s) => s.etiqueta)).toEqual(['Clientes', 'Planes', 'Facturación', 'Integraciones', 'Auditoría', 'Demostración']);
    expect(redirigirRutaVieja('/admin/planes/', { '/admin/planes': '/plataforma/planes' })).toBe('/plataforma/planes');
    expect(redirigirRutaVieja('/panel', { '/admin/planes': '/plataforma/planes' })).toBeNull();
    expect(seccionDePlataforma('/plataforma/clientes/odontologos')).toBe('clientes');
    expect(seccionDePlataforma('/admin/config', { '/admin/config': 'integraciones' })).toBe('integraciones');
  });
  it('S-05: glosario unico e idempotente', () => {
    expect(simplificarTexto('Suscribir aviso de estados del webhook')).toBe('activar aviso automático del aviso automático');
    expect(simplificarTexto('Conciliar pagos sin factura')).toBe('revisar estados cobros sin factura');
    expect(simplificarTexto(simplificarTexto('webhook'))).toBe('aviso automático');
  });
  it('S-07: mensaje claro sin casilla y errores legibles', () => {
    expect(validarAceptacion(false)).toBe('Marca la casilla para continuar.');
    expect(validarAceptacion(true)).toBeNull();
    expect(mensajeErrorAceptacion(401)).toMatch(/Kyros ID/);
    expect(mensajeErrorAceptacion(500, 'INTERNAL_ERROR')).toMatch(/No pudimos registrar/);
    expect(mensajeErrorAceptacion(409, 'Ya aceptaste esta versión.')).toBe('Ya aceptaste esta versión.');
  });
  it('S-11: la contrasena demo nunca va en claro', () => {
    const m = enmascarar('Demo-Secreta-123');
    expect(m).not.toContain('Demo');
    expect(m).toMatch(/^•+$/);
  });
  it('S-12: alias de notificaciones', () => {
    expect(ALIAS_NOTIFICACIONES).toContain('/avisos');
  });
  it('S-08: vigencia visible y reenvio', () => {
    const ahora = new Date('2026-11-18T12:00:00Z');
    expect(vigenciaInvitacion('2026-11-25T12:00:00Z', ahora)).toMatchObject({ vencida: false, diasRestantes: 7, texto: 'Vence en 7 días', puedeReenviar: false });
    expect(vigenciaInvitacion('2026-11-18T20:00:00Z', ahora).puedeReenviar).toBe(true);
    expect(vigenciaInvitacion('2026-11-17T12:00:00Z', ahora)).toMatchObject({ vencida: true, puedeReenviar: true });
    expect(vigenciaInvitacion(null).texto).toBe('Sin fecha de vencimiento');
  });
  it('S-06: prorrateo en dinero (matematica de AXION) y lineas de la vista previa', () => {
    const r = calcularProrrateo({ hoy: '2026-11-10', vigenciaHasta: '2026-11-30', centavosActual: 10000, centavosNuevo: 20000 });
    expect(r).toMatchObject({ diasRestantes: 21, creditoCentavos: 7000, costoNuevoCentavos: 14000, cobroCentavos: 7000, diasExtra: 0 });
    const bajada = calcularProrrateo({ hoy: '2026-11-10', vigenciaHasta: '2026-11-30', centavosActual: 20000, centavosNuevo: 10000 });
    expect(bajada.cobroCentavos).toBe(0);
    expect(bajada.diasExtra).toBe(21);
    expect(bajada.vigenciaNueva).toBe('2026-12-21');
    const l = lineasVistaPrevia(vistaPreviaDeProrrateo(r));
    expect(l).toContain('A pagar ahora: Bs 70,00');
    expect(l[l.length - 1]).toBe('No pierdes ningún día ya pagado.');
    expect(() => calcularProrrateo({ hoy: '2026-11-10', vigenciaHasta: null, centavosActual: 1.5, centavosNuevo: 1 })).toThrow(RangeError);
  });
  it('S-06b: la lista sin precio es solo para SuperAdmin', () => {
    const items = [{ nombre: 'IA', precio: null }, { nombre: 'Agenda', precio: 10 }];
    expect(funcionalidadesSinPrecio(items, true)).toEqual(['IA']);
    expect(funcionalidadesSinPrecio(items, false)).toEqual([]);
  });
  it('S-13: rubros del catalogo y NO CONFIRMADO', () => {
    const o = opcionesDeRubro([{ actividadEconomica: '861', descripcion: 'Salud', productosSin: [{ codigoProductoSin: '86190', descripcion: 'Odontología', unidadMedida: 58 }] }]);
    expect(o).toEqual([{ valor: '861|86190', etiqueta: 'Salud — Odontología', actividadEconomica: '861', codigoProductoSin: '86190', unidadMedida: 58 }]);
    expect(resumenCodigosFiscales({ actividadEconomica: '861' })).toEqual(['Actividad económica: 861', 'Producto del SIN: NO CONFIRMADO', 'Unidad de medida: NO CONFIRMADO']);
  });
});
