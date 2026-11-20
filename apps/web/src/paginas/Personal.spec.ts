import { describe, expect, it } from 'vitest';
import { alternarRol } from './Personal';

// GS-N07: edición de roles de una persona desde la pantalla de Personal.
describe('alternarRol', () => {
  it('agrega un rol que no estaba y quita el que ya estaba', () => {
    expect(alternarRol(['mesero'], 'cajero')).toEqual(['mesero', 'cajero']);
    expect(alternarRol(['mesero', 'cajero'], 'mesero')).toEqual(['cajero']);
  });
  it('puede dejar la lista vacía (la pantalla entonces no deja guardar)', () => {
    expect(alternarRol(['mesero'], 'mesero')).toEqual([]);
  });
  it('no modifica el arreglo original', () => {
    const a = ['mesero'];
    alternarRol(a, 'cajero');
    expect(a).toEqual(['mesero']);
  });
});
