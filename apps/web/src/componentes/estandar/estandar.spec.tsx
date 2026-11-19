import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { AceptacionLegal } from './AceptacionLegal';
import { AvisoDemostracion } from './AvisoDemostracion';
import { InvitacionVigencia } from './InvitacionVigencia';
import { PlataformaNav } from './PlataformaNav';
import { SinPermiso } from './SinPermiso';
import { VistaPreviaCambioPlan } from './VistaPreviaCambioPlan';

const r = (el: React.ReactElement) => renderToStaticMarkup(createElement(StaticRouter, { location: '/plataforma/clientes' }, el));

describe('componentes del estándar Kyros en GESTRO', () => {
  it('SinPermiso: título único y a quién pedirlo', () => {
    const h = r(createElement(SinPermiso, { aQuien: 'el dueño' }));
    expect(h).toContain('No tienes permiso para ver esto');
    expect(h).toContain('Pídele acceso a el dueño');
  });
  it('AceptacionLegal: casilla sin marcar y botón «Aceptar y continuar» siempre disponible', () => {
    const h = r(createElement(AceptacionLegal, { enviar: async () => undefined }));
    expect(h).toContain('Aceptar y continuar');
    expect(h).not.toContain('disabled=""');
  });
  it('VistaPreviaCambioPlan: días, fecha efectiva y sin perder días', () => {
    const h = r(createElement(VistaPreviaCambioPlan, { datos: { fechaEfectiva: '2026-11-10', vigenciaNueva: '2026-12-01', diasRestantes: 21, diasExtra: 0, creditoCentavos: null, costoCentavos: null, cobroCentavos: null, sinPerdidaDeDias: true } }));
    expect(h).toContain('Días que te quedan: 21');
    expect(h).toContain('Rige desde: 10/11/2026');
    expect(h).toContain('No pierdes ningún día ya pagado.');
  });
  it('PlataformaNav: las seis secciones', () => {
    const h = r(createElement(PlataformaNav));
    for (const n of ['Clientes', 'Planes', 'Facturación', 'Integraciones', 'Auditoría', 'Demostración']) expect(h).toContain(n);
  });
  it('AvisoDemostracion: aviso permanente y contraseña oculta (nunca en claro)', () => {
    const h = r(createElement(AvisoDemostracion, { contrasena: 'Secreta-Demo-1' }));
    expect(h).toContain('Esto es una demostración');
    expect(h).not.toContain('Secreta-Demo-1');
    expect(h).toContain('Mostrar contraseña de la cuenta de prueba');
  });
  it('InvitacionVigencia: vigencia visible y reenvío con un clic', () => {
    const h = r(createElement(InvitacionVigencia, { enlace: 'https://x/entrar?codigo=a', venceEn: '2026-11-25T12:00:00Z', ahora: new Date('2026-11-18T12:00:00Z'), onReenviar: () => undefined }));
    expect(h).toContain('Vence en 7 días');
    expect(h).toContain('Reenviar invitación');
    expect(h).toContain('Copiar enlace');
  });
});
