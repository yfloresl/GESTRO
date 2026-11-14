import { describe, expect, it } from 'vitest';
import { mensajeDeIngreso } from './Callback';

// GST-R01: un rechazo al ingresar debe decir qué pasó y qué hacer, nunca «HTTP 401».
describe('mensajeDeIngreso', () => {
  it('401 explica que la cuenta no puede entrar y qué hacer', () => {
    const m = mensajeDeIngreso(401, 'HTTP 401');
    expect(m).not.toMatch(/HTTP/);
    expect(m).toMatch(/Crear mi cuenta/);
  });
  it('403, 503 y 429 tienen su texto', () => {
    expect(mensajeDeIngreso(403, '')).toMatch(/desactivada/);
    expect(mensajeDeIngreso(503, '')).toMatch(/Kyros ID no responde/);
    expect(mensajeDeIngreso(429, '')).toMatch(/demasiados intentos/);
  });
  it('un mensaje legible del servidor se conserva; «HTTP nnn» no', () => {
    expect(mensajeDeIngreso(400, 'Falta el código')).toBe('Falta el código');
    expect(mensajeDeIngreso(500, 'HTTP 500')).not.toMatch(/HTTP/);
    expect(mensajeDeIngreso(undefined, undefined)).toMatch(/No pudimos completar/);
  });
});
