# Listas de precios (precio de empleados JDH)

El catálogo muestra a los **empleados JDH autenticados** el precio de la lista
`empleados-jdh`, que calcula la intranet (maestro de productos):

- costo = costo promedio de la bodega **MDE1** (foto de inventario de la mañana
  del DWH), por unidad de inventario, sin IVA;
- precio = costo / (1 − Margen Empleado JDH), hoy 13 %, en pesos enteros;
- precio con IVA = precio × (1 + IVA / 100), en pesos enteros.

Solo vienen productos activos con costo en MDE1. El costo y el margen **no**
llegan al catálogo: el archivo no los trae y el cargador ignora cualquier campo
fuera del contrato.

## Tabla `product_list_prices`

Tabla propia, separada de `products`. El sync del DWH (`products-sync`) nunca
la lee ni la escribe, y el cargador nunca escribe en `products` (la columna
heredada `products.price` sigue sin uso: es una sola columna, sin lista ni fecha
de la foto).

| Columna | Qué es |
|---|---|
| `list`, `sku` | Clave única: un precio por SKU dentro de cada lista |
| `producto_key` | Producto resuelto por SKU al cargar (ver abajo); `null` si no hay uno solo |
| `inventory_unit` | Unidad a la que corresponde el precio (`UNIDAD`, …) |
| `price`, `vat_pct`, `price_with_vat`, `currency` | Importes en pesos. `vat_pct` 19, 5 o **0** (grupos SIN IVA de SIESA, se facturan al 0 %); `null` solo si SIESA tiene la tasa vacía en un grupo con IVA (precio con IVA = precio, «IVA por confirmar»). 0 y `null` nunca se confunden |
| `generated_at`, `snapshot_date` | Cuándo generó la fuente el archivo y fecha de la foto de costos |
| `loaded_at` | Última carga que confirmó la fila |
| `updated_at` | Último cambio real (precio, IVA, unidad o producto resuelto) |

**SKU → producto.** En `products` el SKU no es único entre compañías. Al cargar
se resuelve cada SKU: si hay un solo producto, ese; si hay varios, el único
activo; si sigue habiendo más de uno, queda sin producto (`ambiguous` en el
reporte) y el precio no se muestra en ninguno: mejor sin precio que con el de
otro producto. La lectura se une por `producto_key`, igual que la
categorización, así que sobrevive a cambios del sync. Un producto que aparezca
en el catálogo después de la carga recibe su precio en la siguiente carga.

## Carga: `pnpm prices:load`

```bash
pnpm prices:load data/precios/catalogo-precios-empleados-jdh.json --dry-run
pnpm prices:load data/precios/catalogo-precios-empleados-jdh.json
```

- Valida el archivo completo antes de escribir: SKU repetido, importe no
  decimal, cabecera inválida o `total` distinto del número de `items`
  (archivo truncado) abortan la carga sin tocar la base.
- Upsert por (lista, SKU) en una transacción; los SKUs que estaban en la lista
  y ya no vienen se **quitan de la lista** (nunca se borra un producto).
- Idempotente: repetir el mismo archivo da `changed: 0`.
- Rechaza un archivo con `generated_at` anterior al de la lista vigente (volver
  atrás por error); `--force` lo permite.
- Reporte: `read`, `inserted`, `changed`, `unchanged`, `removed`, `matched`
  (y de ellos `matchedInactive`), `notInCatalog`, `ambiguous`, muestras de SKUs y

`data/precios/` está en `.gitignore`: son datos internos que cambian a diario.
En la VPS el cargador corre dentro del contenedor del API, como la
categorización (`docker exec … node dist/src/modules/product-prices/load-prices.cli <archivo>`).
`pnpm push:catalogo` **no** lleva esta tabla.

## Quién ve el precio

`/products` (listado, destacados y ficha) sigue siendo público y acepta un
`Authorization: Bearer <jwt>` **opcional** (`OptionalJwtAuthGuard`):

| Petición | Resultado |
|---|---|
| Sin token | Respuesta pública, **sin** el campo `precioEmpleado` |
| Token válido sin `empleado: true` (cliente) | Sin el campo |
| Token válido con `empleado: true` | `precioEmpleado` en cada producto: objeto o `null` si no está en la lista |
| Token inválido, caducado o de otra audiencia | 401 |
| Token pero sin poder verificarlo (sin `AUTH_JWKS_URL`, JWKS caído) | Se atiende como anónimo (el catálogo no se cae) |

### Marca de empleado: claim `empleado`

El JWT lo firma la UI (Better Auth, plugin `jwt`, EdDSA, `iss=jdh-catalogo-ui`,
`aud=jdh-catalogo-api`) y este API lo verifica contra el JWKS de la UI. La UI
pone `empleado: true` **solo** cuando la sesión viene del login con Entra ID del
tenant JDH (proveedor `microsoft`); las cuentas de cliente (email + contraseña)
no lo llevan. El API acepta únicamente el booleano `true`; ausente, `false`,
`"true"` o cualquier otro valor cuentan como no empleado. No se infiere de los
roles: un empleado sin App Role en Entra tiene rol `cliente`, igual que un
cliente externo.

El navegador no tiene ese token (la autoridad es la cookie de la UI), así que
la UI debe pedir los productos **desde su servidor** con `backendFetch` cuando
el usuario es empleado, igual que favoritos y listas.

### Contrato

```jsonc
{
  "id": 123,
  "sku": "1000",
  // … resto del producto, sin cambios …
  "precioEmpleado": {
    "precio": 49863,        // sin IVA, pesos enteros
    "precioConIva": 59337,  // pesos enteros
    "ivaPct": 19,           // 19, 5 o 0 (Sin IVA); null = tasa desconocida (precioConIva = precio)
    "moneda": "COP",
    "unidad": "UNIDAD",     // unidad de inventario a la que corresponde
    "fechaFoto": "2026-11-17"
  }
}
```

### Caché

- La caché de Redis (`HttpCacheInterceptor`) solo guarda la respuesta
  **anónima**. `EmployeePriceInterceptor` va por fuera de ella y superpone el
  precio en cada petición de un empleado con una consulta por página
  (`product_list_prices` ⋈ `products` por `producto_key`). Una carga nueva se ve
  de inmediato, sin invalidar nada, y una respuesta con precio nunca entra en
  una caché compartida.
- Todas las respuestas de `/products` llevan `Vary: Authorization`; las
  autenticadas, además, `Cache-Control: private, no-store`. El ETag de Express
  se calcula sobre el cuerpo, así que difiere entre la versión anónima y la de
  empleado.
- `GET /favorites` y `GET /order-lists/:id/items` (en `product`) también llevan `precioEmpleado` para empleados, con el mismo interceptor.

## IVA e impuestos

- `ivaPct: 0` es **Sin IVA**: el producto se factura al 0 % (arroz, sal, fríjol,
  panela, algunos de aseo…). Mostrar «Sin IVA».
- `ivaPct: null` es una tasa **desconocida** en SIESA (grupo con IVA sin tasa).
  `precioConIva` = `precio`. Mostrar «IVA por confirmar», **nunca** «Sin IVA».
- `ivaEtiqueta` sale de `vat_label` de la fuente; si no viene, se deriva igual
  (`vatLabelFor`: 0 → «Sin IVA», n → «IVA n %», null → «IVA por confirmar»).
- `precioConIva` incluye **solo IVA**. IBUA (bebidas azucaradas) e impuesto al
  consumo de licores no vienen en la lista: es una decisión pendiente de la
  intranet y el catálogo no los inventa.

## Resumen del carrito (regla de cálculo)

Todavía no hay carrito; la regla y el modelo quedan listos en
`src/modules/product-prices/cart-summary.ts` (`summarizeCart`, con tests).

1. **Foto al agregar.** Cada línea guarda, al momento de agregarse, un
   `PriceSnapshot`: `{ lista, precio (sin IVA), ivaPct, fechaFoto }`. El
   resumen se calcula con la foto, no con la lista vigente, para que una
   recarga no cambie el carrito en silencio. `priceSnapshotChanged(foto,
   precioEmpleadoActual)` dice si hay que avisar de un cambio (precio, IVA o
   producto fuera de la lista).
2. **Por línea, como una factura:** `base = precio × cantidad`;
   `iva = redondeo(base × ivaPct / 100)` a pesos enteros, mitad hacia arriba
   (en aritmética entera, sin errores de coma flotante).
3. **Totales:** subtotal sin IVA = Σ bases; IVA **agrupado por tarifa**
   (IVA 19 %, IVA 5 % y la base Sin IVA aparte con IVA $0); total = subtotal +
   Σ IVA + Σ otros impuestos.
4. **No** sumar `precioConIva × cantidad`: el redondeo por unidad se aleja del
   valor facturado en cantidades grandes (4.211 × 1,19 × 1.000 = 5.011.000; la
   factura da 5.011.090).
5. Líneas con `ivaPct` null van a `ivaPorConfirmar` (base y número de líneas),
   aparte, nunca mezcladas con Sin IVA; su IVA no entra al total.
6. `otrosImpuestos` existe en el resumen (vacío por ahora) para IBUA y licores
   cuando la intranet los envíe.

```jsonc
{
  "subtotal": 199275,
  "tarifas": [
    { "ivaPct": 19, "etiqueta": "IVA 19 %", "base": 158011, "iva": 30022 },
    { "ivaPct": 5,  "etiqueta": "IVA 5 %",  "base": 10000,  "iva": 500 },
    { "ivaPct": 0,  "etiqueta": "Sin IVA",  "base": 31264,  "iva": 0 }
  ],
  "ivaPorConfirmar": null,
  "iva": 30522,
  "otrosImpuestos": [],
  "total": 229797
}
```
