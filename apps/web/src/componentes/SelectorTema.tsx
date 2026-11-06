import { useEffect, useState } from 'react';

type Tema = 'claro' | 'oscuro';
const CLAVE = 'gestro.tema';
const guardado = (): Tema | null => { try { const v = localStorage.getItem(CLAVE); return v === 'claro' || v === 'oscuro' ? v : null; } catch { return null; } };
const delSistema = (): Tema => (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro');

/** Claro / oscuro: respeta la preferencia del sistema hasta que la persona elige; después recuerda su elección. */
export function SelectorTema() {
  const [tema, setTema] = useState<Tema>(() => guardado() ?? delSistema());
  useEffect(() => { document.documentElement.classList.toggle('dark', tema === 'oscuro'); }, [tema]);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia('(prefers-color-scheme: dark)'); const f = () => { if (!guardado()) setTema(delSistema()); };
    m.addEventListener('change', f); return () => m.removeEventListener('change', f);
  }, []);
  const cambiar = () => { const n: Tema = tema === 'oscuro' ? 'claro' : 'oscuro'; try { localStorage.setItem(CLAVE, n); } catch { /* sin almacenamiento */ } setTema(n); };
  return (
    <button type="button" onClick={cambiar} aria-label={tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} title={tema === 'oscuro' ? 'Modo claro' : 'Modo oscuro'}
      className="w-12 h-12 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-colors">
      <span className="material-symbols-outlined" aria-hidden="true">{tema === 'oscuro' ? 'light_mode' : 'dark_mode'}</span>
    </button>
  );
}
