# Textos legales de GESTRO

BORRADORES – revisar con abogado. Fuente única de Términos, Privacidad y Políticas, en `es/` y `en/`. La versión vigente está en `apps/api/src/legal/legal.ts` (`VERSION_LEGAL`) y cada texto la declara en su segunda línea.

Después de editar, copia a la web con `node scripts/sync-legal.mjs` (la imagen de la web solo ve `apps/web`). Una prueba de la API falla si las copias se desfasan o si la versión de un texto no coincide.

Cada cambio de fondo exige subir `VERSION_LEGAL`: a partir de ahí, todas las personas deben aceptar de nuevo.
