// Los textos legales viven en docs/legal (fuente). Este script los copia a:
//  - apps/web/src/legal (la imagen de la web solo ve apps/web) y
//  - apps/api/src/legal/textos.generated.ts (la API los sirve en GET /public/legal/:doc/vigente sin depender de archivos en disco).
// Uso: node scripts/sync-legal.mjs   (una prueba de la API verifica que las copias no se desfasen)
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(raiz, 'apps/web/src/legal'), { recursive: true });
cpSync(join(raiz, 'docs/legal'), join(raiz, 'apps/web/src/legal'), { recursive: true, filter: (o) => !o.endsWith('README.md') });

const textos = {};
for (const idioma of ['es', 'en']) for (const doc of ['terminos', 'privacidad', 'politicas']) textos[`${idioma}/${doc}`] = readFileSync(join(raiz, 'docs/legal', idioma, `${doc}.md`), 'utf8').replace(/\r\n/g, '\n');
writeFileSync(join(raiz, 'apps/api/src/legal/textos.generated.ts'),
  `// GENERADO por scripts/sync-legal.mjs desde docs/legal. No editar a mano.\nexport const TEXTOS_LEGALES: Record<string, string> = ${JSON.stringify(textos, null, 2)};\n`);
console.log('Textos legales copiados a apps/web/src/legal y apps/api/src/legal/textos.generated.ts');
