// Base de datos de desarrollo y pruebas sin Docker: usa el PostgreSQL 16 instalado en
// la máquina, con una carpeta de datos propia en .datos/pg y el puerto 5434 solo en
// 127.0.0.1. Igual que en producción, va sin contraseña.
//   node scripts/bd-local.mjs arriba | abajo | estado
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const datos = join(raiz, ".datos", "pg");
const registro = join(raiz, ".datos", "pg.log");
const PUERTO = "5434";

function binarios() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const candidatos = [];
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\PostgreSQL";
    if (existsSync(base)) for (const v of readdirSync(base).sort().reverse()) candidatos.push(join(base, v, "bin"));
  }
  for (const dir of candidatos) if (existsSync(join(dir, `pg_ctl${exe}`))) return (n) => join(dir, n + exe);
  return (n) => n; // en otros sistemas se espera que estén en el PATH
}
const bin = binarios();
// Sin heredar la salida: el servidor queda vivo y no debe retener la consola de quien lo lanzó.
const pgCtl = (...args) => spawnSync(bin("pg_ctl"), ["-D", datos, ...args], { stdio: "ignore" }).status;
const corriendo = () => spawnSync(bin("pg_ctl"), ["-D", datos, "status"], { stdio: "ignore" }).status === 0;

const orden = process.argv[2] ?? "estado";
if (orden === "arriba") {
  if (!existsSync(join(datos, "PG_VERSION"))) {
    mkdirSync(dirname(datos), { recursive: true });
    execFileSync(bin("initdb"), ["-D", datos, "-U", "gestro", "-A", "trust", "-E", "UTF8", "--locale=C"], { stdio: "inherit" });
  }
  if (!corriendo()) {
    const estado = pgCtl("-l", registro, "-o", `-p ${PUERTO} -c listen_addresses=127.0.0.1`, "-w", "start");
    if (estado !== 0) process.exit(estado ?? 1);
  }
  // La base "gestro" se crea la primera vez; si ya existe, createdb falla y se ignora.
  spawnSync(bin("createdb"), ["-h", "127.0.0.1", "-p", PUERTO, "-U", "gestro", "gestro"], { stdio: "ignore" });
  console.log(`Base de desarrollo lista en 127.0.0.1:${PUERTO}`);
} else if (orden === "abajo") {
  if (corriendo()) pgCtl("-m", "fast", "-w", "stop");
  console.log("Base de desarrollo detenida.");
} else {
  console.log(corriendo() ? `Encendida en 127.0.0.1:${PUERTO}` : "Apagada.");
}
