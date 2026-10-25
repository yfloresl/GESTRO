# GESTRO · DESIGN.md (fuente de verdad de tokens)

Origen: diseño Stitch «Andina GastroOS» (28 pantallas en `.design/fuente/`). Marca de la pantalla: **GESTRO**
(solo cambian nombre y logo; colores, tipografía y formas se conservan). Los tokens se cargan en
`apps/web/tokens.json`, extraído sin cambios del `tailwind.config` exportado de la pantalla 5.1. Las 28
pantallas comparten el mismo conjunto de tokens.

## Atmósfera
Industrial limpio, cálido y utilitario. Contraste alto, separación por bordes y capas tonales, sin sombras difusas.
Dos modos: salón y caja en claro; cocina (KDS) en oscuro (`inverse-surface`).

## Colores (Material 3 de Stitch)
Primario `#00375e` (container `#1f4e79`), secundario ámbar `#7c5800` (container `#febb2a`), terciario verde
`#003e1a` (container `#005827`), error `#ba1a1a`. Fondo `#f7f9fc`, superficies `#ffffff`→`#e0e3e6`.
Lista completa: `apps/web/tokens.json` (`colors`). Semánticos del DESIGN.md original: listo = verde cocina,
demora = carmesí, aviso = mandarina.

## Tipografía
Inter (cuerpo y títulos) y JetBrains Mono (cifras, mesas, tiempos, etiquetas). Escala exacta en `fontSize`:
headline-xl 40/48 · lg 32/40 · md 24/32 · sm 20/28 · body-lg 18/26 · md 16/24 · sm 14/20 · label-lg 16/20 · md 14/18 · sm 12/16.
Importes siempre `Bs 45.00`. Fuentes e iconos **autohospedados** (sin CDN).

## Geometría
`borderRadius` del diseño exportado: DEFAULT 0.25rem · lg 0.5rem · xl 0.75rem · full 9999px.
(El DESIGN.md original dice 8/12/16 px: las pantallas usan `rounded-lg` = 8 px y `rounded-xl` = 12 px; se sigue el código exportado.)
Sombras: nivel 1 `0 1px 8px rgba(0,0,0,.04)`. Toques ≥ 48 px (POS 56 px).

## Espaciado
`space-xs .25rem · sm .5rem · md 1rem · lg 1.5rem · xl 2rem`, `gutter 1/1.25/1.5rem`, `margin 1/1.5/2rem`.
Barra lateral 18rem (w-72), cabecera 4rem (h-16).

## Iconos
Material Symbols Outlined, 20 px en navegación, 18–24 px en acciones.

## Discrepancia registrada
El `DESIGN.md` de Stitch habla de «Petroleum Navy `#1F4E79`» como color primario; en el código exportado el
primario es `#00375e` y `#1f4e79` es `primary-container`. Se sigue el código (`bg-primary` para marca y
`bg-primary-container` para estado activo del menú), como hacen las pantallas.
