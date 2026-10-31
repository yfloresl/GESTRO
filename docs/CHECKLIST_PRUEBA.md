# Checklist de prueba como usuario real (para Yamil)

Probado el 2026-10-31 en entorno local descartable (API real + demo de 75 días, sin tocar producción). Marca ✔ lo que revises tú en producción con las cuentas `prueba_kyros_gestro_*`.

| Área | Qué revisar | Estado local |
|---|---|---|
| Salón | Mapa con mesas ocupadas, llamados, «Atendido» | ✔ (mesas ocupadas añadidas) |
| Pedidos | Lista en curso; clic abre el pedido | ✔ |
| Cocina | Tickets por estado (cuenta cocina) | ✔ datos; revisar con cuenta cocina |
| Caja | Abrir caja y cobrar (la demo es solo lectura: aquí solo se ve) | ✔ pantalla |
| Inventario | Existencias sin negativos, 1 alerta (Queso), kardex | ✔ (corregido) |
| Recetas | Costo y margen por plato | ✔ |
| Reservas | Agenda del día; clic en el nombre abre la ficha | ✔ (ficha añadida) |
| Cobranzas | Clic en el cliente abre su ficha con saldos y «Cobrar» | ✔ (ficha añadida) |
| Compras | Órdenes borrador/enviada/recibida, por pagar | ✔ |
| Turnos | Semana y funciones con cuenta de área | revisar con cuenta área |

Pendiente conocido: ocultar en la web los módulos que un plan no incluye (los paquetes están apagados por defecto).
