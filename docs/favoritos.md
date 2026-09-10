# Favoritos por usuario

Primera superficie **autenticada** del catálogo. Todo lo demás
(`/products`, `/suppliers`, `/brands`, `/health`) sigue siendo público y sin
sesión.

## El guard JWT

Esta API **no emite tokens, no gestiona sesiones y no toca la base
`jdh_auth`**. Solo verifica el JWT que firma `jdh-catalogo-ui`, con la clave
pública que descarga de su JWKS. Esa separación es justo la razón de que la
firma sea asimétrica: el catálogo no necesita —ni debe tener— acceso a las
credenciales de los clientes.

El contrato del token lo define la UI (`docs/despliegue.md` §9 de
`jdh-catalogo-ui`); aquí solo se implementa el lado verificador:

| | |
| --- | --- |
| Algoritmo | `EdDSA` (Ed25519), asimétrico |
| JWKS | `GET {origen de la UI}/api/auth/jwks` — solo clave pública |
| `iss` | `jdh-catalogo-ui` (`AUTH_JWT_ISSUER`) |
| `aud` | `jdh-catalogo-api` (`AUTH_JWT_AUDIENCE`) |
| Vida del token | 5 min |
| Identidad | claim `sub` |

Tres decisiones que conviene no deshacer:

- **La audiencia se verifica, no solo la firma.** Sin eso, un token emitido
  para otro consumidor de la misma UI valdría contra este API.
- **`AUTH_JWKS_URL` no se deriva de `iss`.** El issuer es un identificador
  lógico estable, no una URL alcanzable: la URL del JWKS es la del origen de
  la UI **del mismo entorno**, y se configura aparte.
- **El `sub` se guarda como string opaco.** No hay FK, ni tabla de usuarios,
  ni consulta a `jdh_auth`. El token trae además `clienteId` y
  `listaPrecioId`: son referencias a verificar contra el ERP, no permisos
  concedidos, y para favoritos no hacen falta — por eso el guard no los
  propaga.

`jose` cachea el JWKS, así que verificar no añade una llamada de red por
petición.

### Es opt-in por ruta

`JwtAuthGuard` se declara con `@UseGuards(JwtAuthGuard)` en el controlador
que lo necesita. **No** está registrado como `APP_GUARD` (a diferencia del
rate limiting): el catálogo público lo consume la UI sin sesión y registrarlo
globalmente lo rompería.

### Es opcional al arrancar

Sin `AUTH_JWKS_URL` la API arranca igual, sirve todo el catálogo público y
solo `/favorites` responde **503** con un mensaje explícito. Mismo criterio
que el DWH: el catálogo debe poder servir aunque su dependencia opcional no
esté configurada, y el despliegue del API no queda atado al de la UI.

### 401 frente a 503

| Situación | Respuesta |
| --- | --- |
| Sin cabecera `Authorization`, u otro esquema | 401 |
| Firma inválida, `aud`/`iss` que no cuadran, token caducado | 401 |
| `AUTH_JWKS_URL` sin configurar | 503 |
| JWKS inalcanzable (UI caída, timeout) | 503 |

La distinción importa: si la UI está caída, el token del usuario sigue siendo
bueno, y un 401 provocaría cierres de sesión en cascada por un fallo que no es
suyo.

Hay 30 s de tolerancia de reloj entre la UI y el API: con tokens de 5 minutos,
unos segundos de desfase entre contenedores no deberían leerse como sesión
caducada.

## El modelo

```prisma
model Favorite {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")     // claim `sub`, opaco
  productId Int      @map("product_id")
  createdAt DateTime @default(now()) @map("created_at")

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([userId, productId])
  @@index([userId, createdAt])
  @@map("favorites")
}
```

- El `@@unique` es lo que hace **idempotente el alta sin leer antes**: el alta
  es un `INSERT ... ON CONFLICT DO NOTHING` (`createMany` con
  `skipDuplicates`), así que dos clics simultáneos no pueden cruzarse entre un
  SELECT y un INSERT.
- El índice `(user_id, created_at)` sirve el orden de la lista.

## Los endpoints

Todos exigen JWT válido. Ninguno pasa por `HttpCacheInterceptor`: su clave de
caché es ruta + query, **sin la identidad del usuario**, así que cachear estas
respuestas serviría los favoritos de una persona a la siguiente.

Los cuatro filtran por **producto activo**, igual que el catálogo público. Un
producto que el sync desactivó ya no se puede abrir; dejarlo en la lista solo
produciría fichas rotas. Como el filtro es el mismo en la lista y en el
contador, los dos totales coinciden siempre.

### `GET /favorites?page=&limit=`

Devuelve `{ data, meta }`, **el mismo shape que `GET /products`**, y cada item
es el `Producto` completo (con `imagenes`) — no solo el id. Es deliberado: la
UI reusa su schema de página de productos tal cual y la página de favoritos
reusa la card del catálogo, sin schema nuevo y sin un N+1 por producto.

Orden: `created_at desc`, con **desempate por `id`**. El desempate no es
decorativo: varios favoritos pueden compartir `created_at` y sin un criterio
determinista Postgres puede devolver las filas empatadas en distinto orden
entre dos `LIMIT/OFFSET` — un producto repetido en una página y otro que no
sale en ninguna. Es el mismo problema que ya corrigió el orden del catálogo.

### `GET /favorites/ids`

```json
{ "ids": [42, 10, 7], "total": 3 }
```

Una sola petición cacheable resuelve las dos cosas que necesita la UI: qué
productos del grid visible están en favoritos, y el número del contador del
header. Sin él serían 12 comprobaciones por página más una llamada de conteo.

`ids` va en el mismo orden que la lista y **se recorta a 1000**
(`FAVORITE_IDS_LIMIT`); `total` es el conteo real y **nunca** se recorta, así
que el contador sigue siendo correcto aunque una cuenta anómala pase del tope.
En un catálogo B2B lo esperable son decenas.

### `PUT /favorites/:productId`

Alta **idempotente**: repetir no falla ni duplica. **404** si el producto no
existe o está inactivo. Responde con el estado final:

```json
{ "productId": 10, "favorito": true }
```

### `DELETE /favorites/:productId`

Baja **idempotente**: quitar algo que no estaba devuelve éxito, no 404 — el
objetivo es que el usuario no lo tenga, y eso ya se cumple. Tampoco comprueba
que el producto siga en catálogo. Responde `{ "productId": 10, "favorito":
false }`.

Las dos son idempotentes a propósito: la UI hace toggle optimista, y un doble
clic o un reintento no debe romper nada. Y las dos devuelven el **estado
final**, no lo que cambió, para que la UI reconcilie sin adivinar si fue su
petición la que aplicó el cambio.

Un `:productId` malformado es **400**, no el 404 del catálogo público: no se
está consultando un recurso que pueda no existir, se está pidiendo una
escritura con un argumento ininteligible.

## Configuración

```bash
# Origen de la UI del MISMO entorno + /api/auth/jwks
# (3111 es el puerto de pruebas locales de jdh-catalogo-ui)
AUTH_JWKS_URL=http://host.docker.internal:3111/api/auth/jwks
AUTH_JWT_ISSUER=jdh-catalogo-ui     # por defecto
AUTH_JWT_AUDIENCE=jdh-catalogo-api  # por defecto
```

`host.docker.internal` y no `localhost`: la UI corre en el host, y dentro del
contenedor `api` `localhost` es el propio contenedor. Docker Desktop resuelve
ese nombre también desde el host, así que el mismo valor sirve tanto para
`pnpm start:dev` como para `pnpm docker:up` (para Linux, `compose.yaml` añade
el `extra_hosts` correspondiente).

### En la instancia desplegada (Railway)

`AUTH_JWKS_URL` es la **única** variable que hay que declarar allá; el resto
tiene valores por defecto correctos y no hay variables nuevas de base de datos
(la tabla la crea `prisma migrate deploy`, que ya corre el `entrypoint.sh`).

En producción el origen es el dominio propio de la UI, no un host de Railway
(el de Railway es el de esta API):

```bash
AUTH_JWKS_URL=https://catalogo.jdh.com.co/api/auth/jwks
```

Tres cosas:

- **Sin barra final en el origen.** Con `https://catalogo.jdh.com.co/` se
  acabaría pidiendo `//api/auth/jwks`.
- **Una por entorno, apuntando a la UI de ese mismo entorno.** Cada entorno de
  la UI firma con su propia clave, así que un token de preview no debe validar
  contra producción. Si se cruzan, la firma cuadra pero `iss`/`aud` no: el
  síntoma es 401 solo en favoritos, con el resto del catálogo en 200.
- **No es un bloqueante de despliegue.** Sin la variable la API arranca y
  sirve todo el catálogo; solo `/favorites` responde 503. Se puede desplegar
  esta API antes que la UI y encender favoritos después.

`jose` v6 es ESM-only y se carga desde código CommonJS con `require(esm)`, que
Node soporta de serie desde **22.12**. La imagen de producción es
`node:22-alpine`; si alguna vez se fija a un 22 anterior, esto deja de
arrancar.

## Verificación

```bash
# Sin token: 401
curl -i http://localhost:8080/api/v1/favorites

# Con token de la UI
TOKEN=...   # el JWT que emite jdh-catalogo-ui
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/favorites/ids
curl -X PUT    -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/favorites/10
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/favorites/10
```
