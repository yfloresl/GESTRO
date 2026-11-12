// Genera el APK debug (firmado con el keystore debug de Android) y lo copia a <raiz>/dist/android/gestro-debug.apk.
// Uso: pnpm --filter @gestro/android android:build   (requiere JDK 17 y Android SDK; ver README).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const root = resolve(appDir, '../..');
const win = process.platform === 'win32';
const env = { ...process.env };
env.ANDROID_HOME ??= env.ANDROID_SDK_ROOT ?? (win ? join(env.LOCALAPPDATA ?? '', 'Android', 'Sdk') : join(env.HOME ?? '', 'Android', 'Sdk'));
if (!existsSync(env.ANDROID_HOME)) throw new Error(`ANDROID_HOME no existe: ${env.ANDROID_HOME}`);

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: win });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} falló (${r.status})`);
}

run('pnpm', ['exec', 'cap', 'sync', 'android'], appDir);
const gradleDir = join(appDir, 'android');
run(win ? `"${join(gradleDir, 'gradlew.bat')}"` : './gradlew', ['assembleDebug'], gradleDir);   // ruta absoluta: en Windows el directorio actual no está en el PATH
const apk = join(appDir, 'android/app/build/outputs/apk/debug/app-debug.apk');
const out = join(root, 'dist/android');
mkdirSync(out, { recursive: true });
copyFileSync(apk, join(out, 'gestro-debug.apk'));
console.log(`APK: ${join(out, 'gestro-debug.apk')}`);
