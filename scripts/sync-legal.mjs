// Los textos legales viven en docs/legal (fuente) y se copian a apps/web/src/legal porque la imagen de la web solo ve apps/web.
// Uso: node scripts/sync-legal.mjs   (una prueba de la API verifica que las copias no se desfasen)
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(raiz, 'apps/web/src/legal'), { recursive: true });
cpSync(join(raiz, 'docs/legal'), join(raiz, 'apps/web/src/legal'), { recursive: true, filter: (o) => !o.endsWith('README.md') });
console.log('Textos legales copiados a apps/web/src/legal');
