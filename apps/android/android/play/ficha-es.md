# Ficha de Google Play (borrador) — GESTRO

Generada el 16/11/2026 por el QA de Kyros-Tech. Copie los textos a Play Console; ver la lista de pasos en `informes/QA-ANDROID-PUBLICACION.md` del repositorio de QA.

## Datos de la ficha
| Campo | Valor |
| --- | --- |
| Nombre visible (≤ 30) | GESTRO (6 caracteres) |
| ID de paquete (definitivo, no se cambia) | `com.kyros.gestro` |
| Tipo / categoría | Aplicación / Empresas (Business) |
| Correo de contacto | administracion@kyros-tech.com |
| Sitio web | https://www.kyros-tech.com |
| Política de privacidad (v2.3, vigente desde 15/11/2026) | https://www.kyros-tech.com/es/privacidad/ |
| Términos | https://www.kyros-tech.com/es/terminos/ |
| Contenido | Carga el sistema en línea: https://gestro.kyros-tech.com |
| Anuncios | No contiene anuncios |
| Público objetivo | Mayores de 18 años (no está dirigida a menores) |
| Compras dentro de la app | No (los planes se contratan con Kyros-Tech, fuera de la app) — confirmar antes de enviar |

## Descripción corta (≤ 80 caracteres)
Gestión de restaurantes: mesas, pedidos, cocina y caja en un solo sistema.  _(74 caracteres)_

## Descripción larga (≤ 4000 caracteres)
GESTRO es el sistema de gestión para restaurantes y locales gastronómicos de Kyros-Tech. La aplicación te lleva el salón, la cocina y la caja al bolsillo.

Qué puedes hacer:
- Tomar pedidos por mesa y enviarlos a cocina.
- Seguir el estado de cada pedido (cocina, entrega, cobro).
- Cobrar y revisar la caja del turno.
- Consultar estadísticas de ventas y alertas del negocio.
- Trabajar con varias sucursales según tu rol (dueño, mesero, cocina, caja).

El ingreso se hace con Kyros ID en el navegador del sistema; la aplicación no guarda tu contraseña.

Necesitas una cuenta creada por tu restaurante. Soporte: administracion@kyros-tech.com.  _(643 caracteres)_

## Seguridad de los datos (borrador para el formulario de Play Console)
Este borrador sale del comportamiento del código; **el dueño debe confirmarlo contra el sistema en producción** antes de enviarlo (Google responsabiliza al desarrollador de su exactitud).
- ¿La app recopila o comparte datos de usuario requeridos? **Sí** (cuenta e información que el usuario o su organización cargan).
- Cifrado en tránsito: **Sí** (solo https; tráfico en claro desactivado en la app).
- ¿Puede el usuario pedir que se eliminen sus datos? **Sí** (vía Kyros-Tech: administracion@kyros-tech.com; 15 días hábiles según la política). **Pendiente:** Play exige además una **ruta dentro de la app** y un **enlace web** para eliminar la cuenta y sus datos (política de eliminación de cuentas de Play, vigente desde 2024). Debe existir una página pública de «Eliminar mi cuenta» de Kyros ID/sistema y declararla en el formulario.
- Compartición con terceros: **No** se venden ni comparten con terceros para publicidad. Los proveedores que tratan datos por cuenta de Kyros-Tech (alojamiento, correo) no cuentan como «compartir» en el formulario de Play; confirmar la lista real de proveedores con el dueño.
- Datos recopilados (todos: **requeridos**, finalidad: **funcionalidad de la app** y **administración de la cuenta**; algunos también **seguridad/prevención de fraude**):
  - Información personal: nombre y correo del personal (cuenta Kyros ID), identificador de usuario.
  - Información financiera: otra información financiera (ventas y cobros del negocio).
  - Datos de clientes del restaurante (nombre/teléfono) si el local los registra: los ingresa la empresa; Kyros-Tech los trata por cuenta de ella.
- Datos **no** recopilados: ubicación, contactos, fotos y videos del dispositivo, micrófono, cámara, identificadores publicitarios, historial de navegación.

## Clasificación de contenido (cuestionario IARC)
- Categoría: **utilidad / herramienta de empresa o salud** (no es juego ni red social de entretenimiento).
- Violencia, sexo, lenguaje fuerte, drogas, juegos de azar: **No**.
- ¿Los usuarios pueden interactuar o intercambiar contenido? **No** en la app móvil (o solo dentro de la propia empresa).
- ¿Comparte la ubicación del usuario? **No**. ¿Permite compras digitales? **No**.
- Resultado esperado: apto para todos (PEGI 3 / ESRB Everyone) — lo calcula Google al enviar el cuestionario.

## Declaraciones de «Contenido de la app»
- **Aplicaciones de salud:** no aplica.
- **Funciones financieras:** declarar «No ofrece préstamos, billeteras ni criptomonedas». Es un sistema de gestión (contabilidad/cobros del negocio), no una app bancaria.
- Anuncios: No. Noticias: No. Gobierno: No. COVID-19: No. Cuentas de terceros/acceso a la app: la revisión de Play necesita **credenciales de prueba**: use una cuenta de demostración sin datos reales (indique cómo ingresar con Kyros ID).

## Capturas de pantalla a tomar (mínimo 2 de teléfono; recomendado 4–8, PNG/JPEG, 16:9 o 9:16, lado entre 320 y 3840 px)
1. Ingreso con Kyros ID
2. Plano de mesas
3. Toma de pedido
4. Pantalla de cocina
5. Caja y cobro
6. Estadísticas del día
Usar datos de demostración (sin datos reales de personas). Tomarlas del APK de **release** o del emulador con la cuenta de demostración. Opcional: capturas de tableta de 7" y 10".

## Gráficos
- Ícono 512×512 PNG: `android/play/icono-512.png` (el de GESTRO ya existente).
- Gráfico de funciones 1024×500 (obligatorio en la ficha): **falta**; hay que diseñarlo con el arte oficial.
