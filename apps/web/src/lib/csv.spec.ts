import { describe, expect, it } from 'vitest';
import { aCsv, celdaCsv } from './csv';

describe('CSV para el contador (gestro-p03)', () => {
  it('decimales con coma, separador «;» y CRLF', () => {
    expect(aCsv(['Plato', 'Ventas'], [['Pique', '715.80'], ['Sopa', 12.5]])).toBe('Plato;Ventas\r\nPique;715,80\r\nSopa;12,5\r\n');
  });
  it('entrecomilla «;», comillas y saltos de línea', () => {
    expect(celdaCsv('Sopa; con "ají"')).toBe('"Sopa; con ""ají"""');
    expect(celdaCsv('a\nb')).toBe('"a\nb"');
  });
  it('un texto que parece fórmula no se ejecuta en Excel', () => {
    expect(celdaCsv('=SUMA(A1)')).toBe("'=SUMA(A1)");
    expect(celdaCsv('@cmd')).toBe("'@cmd");
  });
  it('un número negativo legítimo no se altera', () => { expect(celdaCsv('-5.25')).toBe('-5,25'); expect(celdaCsv(-3)).toBe('-3'); });
  it('vacíos y tildes', () => { expect(celdaCsv(null)).toBe(''); expect(celdaCsv('Ñandú')).toBe('Ñandú'); });
});
