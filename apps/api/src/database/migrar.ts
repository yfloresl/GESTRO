import { entorno } from '../config/entorno';
import { aplicarMigraciones } from './migraciones';

const revertir = process.argv.includes('--revertir');
aplicarMigraciones(entorno.baseDeDatos, { revertir })
  .then((h) => console.log(h.length ? `[migrar] ${revertir ? 'revertida' : 'aplicadas'}: ${h.join(', ')}` : '[migrar] nada pendiente'))
  .catch((e) => { console.error(e); process.exit(1); });
