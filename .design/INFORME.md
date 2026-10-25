# Informe de fidelidad de diseño · F0

## Verificado (navegador, flujo real con emisor de desarrollo)
- Ingreso, «Completa tu registro» y panel con el shell. Barra lateral (ancho, grupos, iconos, ítem activo `primary-container`), selector de sucursal, usuario con nombre y rol: coinciden con la pantalla 5.1 en tokens, tipografía (Inter y JetBrains Mono) y espaciado.
- Fuentes e iconos autohospedados; sin CDN.

## Derivado (no está en el diseño)
Pantalla de ingreso, registro, código de invitación, menú de cuenta, estado vacío de módulos en construcción, tarjetas de estado del panel. Ver `INVENTARIO.md`.

## Observaciones
- El `DESIGN.md` original y el código exportado difieren en radios y en cuál es el «primario»; se siguió el código exportado (ver `DESIGN.md`).
- Iconos: `material-symbols` pesa 3,4 MB sin subconjunto. Pendiente optimizar con un subconjunto de los iconos usados (antes del piloto).
- Accesibilidad: foco visible, «Saltar al contenido», menú con `aria-*`. Contrastes del diseño no auditados aún (Lighthouse en F1).

- Móvil 375 px: ingreso, registro y panel sin desborde horizontal; cajón de navegación y cabecera compacta.
- La sesión sobrevive a la recarga (refresco rotativo con un solo refresco en vuelo).

## Sin verificar todavía
- Comparación píxel a píxel contra las capturas de `fuente/` (el panel del dueño con KPIs, gráficos y FODA es de F5).
- Pruebas Playwright automatizadas del flujo (hoy se verificó a mano en el navegador integrado).
