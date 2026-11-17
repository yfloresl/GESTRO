import { describe, expect, it } from 'vitest';
import { lineaCuf } from './lineaCuf';

describe('lineaCuf (DN-F13)', () => {
  const et = (f: string) => `Emitida el ${f}`;
  const fm = (i: string) => `fmt(${i})`;
  it('muestra CUF y fecha de emisión cuando el detalle existe', () => {
    expect(lineaCuf('ABC123', '2026-11-17T10:10:00Z', et, fm)).toBe('CUF ABC123 · Emitida el fmt(2026-11-17T10:10:00Z)');
  });
  it('solo CUF si no hay fecha y nada si no hay CUF', () => {
    expect(lineaCuf('ABC123', null, et, fm)).toBe('CUF ABC123');
    expect(lineaCuf(null, '2026-11-17T10:10:00Z', et, fm)).toBeNull();
  });
});
