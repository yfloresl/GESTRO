// Incrementa la versión de esta app Android (android/version.properties).
//   node bump-version.mjs patch   1.0.0 -> 1.0.1
//   node bump-version.mjs minor   1.0.3 -> 1.1.0
//   node bump-version.mjs major   1.4.2 -> 2.0.0
//   node bump-version.mjs code    solo sube versionCode en 1 (reenviar el mismo versionName a Play)
//   node bump-version.mjs 1.2.3   fija versionName y recalcula versionCode
// Regla: versionCode = major*10000 + minor*100 + patch (1.2.3 -> 10203) y SIEMPRE es mayor que el último subido a Google Play
// (Play rechaza un versionCode repetido o menor). Con `code` se suma 1 al actual sin tocar versionName.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const archivo = join(dirname(fileURLToPath(import.meta.url)), 'version.properties');
const texto = readFileSync(archivo, 'utf8');
const leer = (k) => texto.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim();
let code = Number(leer('versionCode'));
let [ma, mi, pa] = (leer('versionName') ?? '').split('.').map(Number);
if (![code, ma, mi, pa].every(Number.isInteger)) throw new Error('version.properties inválido (versionCode entero y versionName x.y.z).');

const orden = process.argv[2];
if (orden === 'patch') pa += 1;
else if (orden === 'minor') { mi += 1; pa = 0; }
else if (orden === 'major') { ma += 1; mi = 0; pa = 0; }
else if (orden === 'code') { /* solo versionCode */ }
else if (/^\d+\.\d+\.\d+$/.test(orden ?? '')) [ma, mi, pa] = orden.split('.').map(Number);
else { console.error('Uso: node bump-version.mjs patch|minor|major|code|x.y.z'); process.exit(1); }

const calculado = ma * 10000 + mi * 100 + pa;
const nuevoCode = orden === 'code' ? code + 1 : Math.max(calculado, code + 1);
const nombre = `${ma}.${mi}.${pa}`;
writeFileSync(archivo, texto.replace(/^versionCode=.*$/m, `versionCode=${nuevoCode}`).replace(/^versionName=.*$/m, `versionName=${nombre}`));
console.log(`versionName ${nombre}, versionCode ${code} -> ${nuevoCode}`);
