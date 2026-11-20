import { describe, expect, it } from 'vitest';
import { detalleNoIncluida } from './FacturacionConfig';

describe('detalleNoIncluida', () => {
  it('quita el «No incluida en tu plan.» que ya trae el servidor para decirlo una sola vez', () => {
    const t = detalleNoIncluida('No incluida en tu plan. Se activa sola con un plan de pago vigente; también puedes pedirla a administracion@kyros-tech.com.');
    expect(t).toBe('Se activa sola con un plan de pago vigente; también puedes pedirla a administracion@kyros-tech.com.');
    expect(t).not.toMatch(/No incluida en tu plan/i);
  });
  it('sin mensaje, ofrece cómo pedirla', () => {
    expect(detalleNoIncluida(null)).toMatch(/administracion@kyros-tech\.com/);
  });
});
