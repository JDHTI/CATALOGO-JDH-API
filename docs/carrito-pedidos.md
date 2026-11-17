# Carrito y pedidos de empleados JDH

Carrito de compras convencional para **empleados JDH autenticados** (JWT con
`empleado: true`), con la lista de precios de empleados
([product-prices.md](product-prices.md)). No hay pasarela de pagos: al enviar
el pedido se registra y se manda un consolidado por correo; la entrega se
gestiona internamente en la oficina.

Todo `/cart` y `/orders` va detrás de `JwtAuthGuard` + `EmployeeGuard`: sin
token 401, con token de cliente 403. Respuestas `Cache-Control: private,
no-store`, sin caché Redis.

## Tablas

| Tabla | Qué guarda |
|---|---|
| `carts` | Un carrito por usuario (`user_id` = `sub` del JWT, string opaco) |
| `cart_items` | `(cart_id, product_id)`, cantidad y el precio/IVA con que se agregó (`added_price`, `added_vat_pct`) solo para marcar `precioCambio` |
| `orders` | Pedido: consecutivo (`number` → `PED-000123`), nombre y correo del empleado, nota, lista y fecha de la foto, `subtotal`, `taxes`, `total`, estado del correo |
| `order_items` | Línea congelada: sku, nombre, cantidad, precio unitario sin IVA, IVA %, base e IVA de la línea |

El carrito **no** cobra con precios guardados: cada lectura usa la lista
vigente. El pedido sí congela todo y no depende de que la lista o el producto
cambien después.

## Endpoints

| Método y ruta | Qué hace |
|---|---|
| `GET /cart` | Líneas con el producto completo (con `precioEmpleado`), `precioUnitario` y `totalLinea` **sin IVA**, `disponible`, `precioCambio`; `resumen` con `lineas`, `unidades`, `subtotal` sin IVA y `lineasNoDisponibles`. **Sin impuestos.** |
| `POST /cart/items/:productId` `{ quantity }` | Agregar: **suma** a lo que ya haya |
| `PUT /cart/items/:productId` `{ quantity }` | Fija la cantidad (idempotente) |
| `DELETE /cart/items/:productId` | Quita la línea (idempotente) |
| `DELETE /cart` | Vacía el carrito |
| `POST /cart/from-list/:listId` `{ mode: 'sumar' \| 'reemplazar' }` | «Comprar esta lista»: lleva una lista de pedido al carrito; lo que no se puede comprar vuelve en `omitidos` (`inactivo`, `sin_precio`, `limite`) |
| `GET /cart/checkout` | Pantalla de enviar pedido: líneas, `subtotal`, `impuestos`, `total` (sin desglose por tarifa), `ivaPorConfirmar`, `fechaFoto`, `solicitante { nombre, email }`, `noDisponibles` |
| `POST /cart/checkout` `{ nota?, totalEsperado? }` | Registra el pedido, vacía el carrito y envía el correo. Devuelve el pedido con `correo`: `enviado`, `error` o `deshabilitado` |
| `GET /orders`, `GET /orders/:id` | Pedidos del empleado (los últimos 50) y uno en detalle |

Reglas:

- 1 a 9.999 unidades por línea; máximo 200 productos distintos.
- Solo se agrega un producto **activo con precio de empleado**: inactivo 404,
  sin precio 422.
- Una línea que deja de estar disponible (producto inactivo o fuera de la
  lista tras una recarga) no suma y **bloquea el envío** (409 con
  `noDisponibles`) hasta quitarla.
- Los 409 traen un `code` estable: `PRECIOS_CAMBIARON` (con `resumen`),
  `NO_DISPONIBLES` (con `noDisponibles`), `CARRITO_VACIO` y `LIMITE_LINEAS`.
  El filtro global conserva los campos propios de los errores 4xx (nunca en
  5xx).
- `totalEsperado` es el total que el empleado vio en la pantalla de enviar
  pedido; si los precios cambiaron, 409 con el resumen nuevo.
- El carrito se bloquea (`SELECT … FOR UPDATE`) mientras se registra el
  pedido: un doble clic produce un pedido y un 409 (carrito vacío).
- El nombre y el correo del empleado salen de los claims `name` y `email` del
  JWT (los firma la UI desde la sesión de Entra). Sin ellos, 422.

## Impuestos

El carrito no muestra IVA. En `GET /cart/checkout`, en el pedido y en el correo
aparecen solo **subtotal, impuestos y total**, sin decir qué productos son
19 %, 5 % o 0 %. Por dentro se calcula como una factura
(`summarizeCart`, ver [product-prices.md](product-prices.md#resumen-del-carrito-regla-de-cálculo)):
IVA por línea sobre `precio × cantidad`, redondeado a pesos (mitad hacia
arriba), y el IVA de cada línea queda guardado en `order_items.vat`. Las líneas
con IVA por confirmar no suman impuestos y el pedido lo marca
(`ivaPorConfirmar`). IBUA y licores no están en la lista (pendiente de la
intranet).

## Correo del pedido

Microsoft Graph con client credentials: token con el scope
`https://graph.microsoft.com/.default` y `POST /users/{MAIL_FROM}/sendMail`.
Solo envía; nunca lee ni modifica buzones.

| Variable | |
|---|---|
| `MAIL_GRAPH_TENANT_ID`, `MAIL_GRAPH_CLIENT_ID`, `MAIL_GRAPH_CLIENT_SECRET` | App de Entra con Mail.Send de aplicación, restringido al remitente por Application Access Policy |
| `MAIL_FROM` | Remitente (`info@jdh.com.co`) |
| `ORDER_EMAIL_TO` | Buzones internos de pedidos, separados por coma. **Vacío**: el consolidado le llega solo al empleado |
| `ORDER_EMAIL_CC_CUSTOMER` | Copia al empleado (por defecto `true`) |
| `MAIL_DISABLED` | `true` apaga el envío aunque haya credenciales. Una variable vacía no sirve para apagarlo: el `.env` la completa |

Sin credenciales o con `MAIL_DISABLED=true` el pedido se registra igual con
`correo: deshabilitado`. Un fallo de Entra o Graph no deshace el pedido: queda
`correo: error` con el detalle en `orders.email_error` (sin secretos). Un 403
`ErrorAccessDenied` de Graph significa que la Application Access Policy no
incluye el buzón remitente: hay que pedírselo al administrador de Entra, no
cambiar de remitente.

Reenviar: `pnpm orders:resend-email <número>` (p. ej. `PED-000123`).

Plantilla: `src/modules/cart/order-email.template.ts`. HTML de correo con tablas
y estilos en línea, colores del catálogo (Negro JDH `#1d1d1b`, neutrales
cálidos), número de pedido, solicitante, fecha, nota, tabla de productos
(SKU, producto, cantidad, precio unitario y total antes de impuestos) y
subtotal, impuestos y total. Todo texto variable se escapa.

> Pruebas: hoy se usa la app de Entra de la intranet (`jdh-mail-service`). Hay
> que separarla en una app propia del catálogo con solo Mail.Send restringida a
> `info@jdh.com.co`.
