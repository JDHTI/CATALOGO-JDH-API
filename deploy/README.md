# Despliegue — Catálogo JDH (tienda)

Stack de producción del catálogo (UI + API) en un solo servidor
(`tienda.jdh.local`, 192.168.100.216). Este repo (API) es el dueño del stack.
Sigue el patrón de la intranet y de app-proveedores: clones lado a lado, build
en el servidor, Caddy como único punto publicado.

```
                ┌──────────── servidor tienda.jdh.local ───────────────┐
navegador ─443─▶│ caddy ─┬─ /            ──────────────▶ ui:3000 (Next) │
                │        ├─ /api/v1/*    ──────────────▶ api:8080 (Nest)│
                │        └─ /media/*     ──▶ storage:9000/<bucket> (GET)│
                │ ui ──▶ api (BACKEND_API_URL, favoritos y listas)      │
                │ api ──▶ ui (JWKS: /api/auth/jwks, verifica el JWT)    │
                │ ui ──▶ postgres (jdh_auth: sesiones, claves JWT)      │
                │ api ──▶ postgres (jdh_catalogo), redis, storage       │
                └──────────────────────────────────────────────────────┘
```

Solo se publican 80/443 (Caddy). Postgres, Redis y el S3 de escritura no son
accesibles desde la red. `/api/v1/health*` no se enruta desde fuera (lo
consultan el healthcheck y `deploy.sh` por la red interna).

Un solo origen para UI y API: el navegador llama a
`https://tienda.jdh.local/api/v1` (sin CORS, sin segundo registro DNS). Las
rutas no chocan: la UI usa `/api/auth`, `/api/favoritos`, `/api/listas`,
`/api/perfil`; la API, solo `/api/v1`.

## Layout en el servidor

| Ruta | Qué es |
|---|---|
| `~/apps/CATALOGO-JDH-API` | Este repo. `deploy/` orquesta todo |
| `~/apps/CATALOGO-JDH-UI` | Frontend (se construye con `target: runtime`) |
| `~/apps/CATALOGO-JDH-API/deploy/.env` | Secretos (600, no versionado) |
| `~/apps/CATALOGO-JDH-API/deploy/caddy/ca/` | CA raíz interna (no versionada) |
| `~/backups/` | Respaldos (`deploy/scripts/backup.sh`) |

## Requisitos externos (fuera del servidor)

1. **DNS** (servidor DNS interno 192.168.100.3): registro A
   `tienda.jdh.local` → 192.168.100.216.
2. **Confianza en la CA.** Caddy firma el certificado con una CA raíz propia
   con *name constraints* (solo `*.jdh.local`). Dos caminos:
   - **Reusar la CA de la intranet (recomendado):** copiar
     `~/apps/INTRANET-JDH-API/deploy/caddy/ca/{root.crt,root.key}` del servidor
     `intranet.jdh.local` a `deploy/caddy/ca/` de este servidor (644 y 600).
     Los equipos que ya reciben la GPO confían en `tienda.jdh.local` sin
     hacer nada más.
   - **CA nueva:** `deploy/scripts/init-ca.sh` y distribuir su
     `deploy/caddy/ca/root.crt` por GPO (*Configuración del equipo →
     Directivas → Configuración de Windows → Configuración de seguridad →
     Directivas de clave pública → Entidades de certificación raíz de
     confianza*). Sin la raíz instalada, los navegadores muestran alerta de
     certificado.
3. **Entra ID** (App Registration del catálogo → Authentication → Web):
   redirect URI `https://tienda.jdh.local/api/auth/callback/microsoft`. Sin él,
   el ingreso del personal responde `AADSTS50011`; el de clientes (email +
   contraseña) no depende de Entra.

## Primera instalación

Con el usuario de despliegue (`tienda`) en la VM:

```bash
# 0. Una sola vez, VM limpia (Debian/Ubuntu): Docker, zona horaria, cron.
#    (Antes de tener el repo, copiar este script con scp.)
deploy/scripts/bootstrap-server.sh --firewall

# 1. Código en ~/apps/CATALOGO-JDH-API y ~/apps/CATALOGO-JDH-UI
#    (copia tar de la rama, o clones: ver «CI/CD» → Clones).

cd ~/apps/CATALOGO-JDH-API
deploy/scripts/init-ca.sh      # o copiar la CA de la intranet (ver arriba)
deploy/scripts/gen-env.sh      # deploy/.env con secretos aleatorios
nano deploy/.env               # completar AUTH_MICROSOFT_ENTRA_ID_* cuando existan
deploy/scripts/deploy.sh       # build + up + verificación
```

`gen-env.sh` acepta las credenciales de Entra por entorno
(`AUTH_MICROSOFT_ENTRA_ID_ID=... deploy/scripts/gen-env.sh`). Si no existen
aún deja valores de relleno: la UI arranca (las exige al importar el módulo) y
el ingreso de clientes funciona.

El primer arranque crea solo:

- Las tablas del catálogo (`api-migrate`: `prisma migrate deploy`) y las de
  Better Auth (`ui-auth-migrate`: `user`, `session`, `account`,
  `verification`, `rateLimit`, `jwks`).
- La base `jdh_auth` (`docker/postgres/init/01-crear-base-auth.sh`, solo con el
  volumen de Postgres vacío).
- El bucket de imágenes, con lectura pública (`storage-init`).

### Datos iniciales (el catálogo arranca VACÍO)

El despliegue responde 200 pero la UI pinta el estado vacío hasta cargar
productos. Dos caminos:

- **Desde el DWH** (el servidor está en la red interna): completar `DWH_HOST`,
  `DWH_DATABASE`, `DWH_USER`, `DWH_PASSWORD` en `deploy/.env`, poner
  `SYNC_PRODUCTS_ENABLED=true` y `deploy/scripts/deploy.sh api`. La
  sincronización corre a las 02:00 (`SYNC_PRODUCTS_CRON`); para lanzarla ya, ver
  `docs/products-sync.md`. Conviene un rol dedicado de solo lectura en el DWH.
- **Desde otra instancia** (p. ej. la base de desarrollo o Railway):
  `pg_dump -Fc` + `deploy/scripts/restore.sh jdh_catalogo <dump>`.

Las imágenes de producto/logos viven en el bucket (`storage_data`). Se cargan
con las herramientas del API contra el S3 del servidor
(`pnpm images:ingest`, `pnpm logos:upload`; ver `docs/product-images.md`). El
S3 no se publica: hay que ejecutarlas desde la VM (contenedor efímero en la
red `tienda-jdh_default`) o copiar el bucket desde R2 con un cliente S3.

## Actualizar

Normalmente lo hace el CI/CD (siguiente sección). A mano:

```bash
# actualizar el código de ~/apps/<repo> (git pull), luego:
deploy/scripts/deploy.sh            # todo
deploy/scripts/deploy.sh ui         # solo un servicio
```

`deploy.sh` hace un respaldo `pre-deploy`, construye, levanta y verifica: la UI
(`/api/health`), la API a través de Caddy (`/api/v1/products`) y por la red
interna (`/health/ready`: db, redis, storage), que el JWKS publique solo la
clave pública, y que `/media` llegue al storage. Si algo falla termina con
código ≠ 0 y muestra `compose ps`.

> `NEXT_PUBLIC_*` se incrustan en el bundle durante el build de la UI
> (`compose.prod.yaml` → `ui.build.args`, derivadas de `TIENDA_HOST`). Cambiar
> el dominio exige `deploy.sh ui`, no basta reiniciar.

### Nombre público (`PUBLIC_HOST`)

La CA interna tiene name constraints (`*.jdh.local`), así que no puede firmar
un dominio como `tienda.jdh.com.co`. Con `PUBLIC_HOST=tienda.jdh.com.co` en
`deploy/.env`:

- Caddy sirve ese nombre **sin `tls internal`** y pide el certificado por ACME
  (Let's Encrypt, reto HTTP-01): el DNS público debe apuntar al servidor y los
  puertos 80 y 443 deben llegar a Caddy.
- Pasa a ser el dominio canónico: `BETTER_AUTH_URL`, `NEXT_PUBLIC_SITE_URL`,
  `/media` y el callback de Entra
  (`https://<PUBLIC_HOST>/api/auth/callback/microsoft`).
- `TIENDA_HOST` sigue sirviéndose con la CA interna; `deploy.sh` verifica por
  ahí y, además, avisa (sin fallar) si el nombre público no tiene certificado.

Orden: poner `PUBLIC_HOST` en `deploy/.env` → `deploy.sh ui api` (recrea Caddy
con el sitio nuevo; `NEXT_PUBLIC_*` exige rebuild de la UI).

## CI/CD

Mismo patrón que la intranet. Cada repo tiene `.github/workflows/ci-cd.yml`:

- **CI** (runners de GitHub, en cada PR y push): lint, tipos y pruebas, y build
  de la imagen Docker (sin publicarla).
- **CD** (push a `master`): un runner self-hosted **en este servidor**
  (etiqueta `tienda-jdh`) lleva el clon de `~/apps/<repo>` al commit exacto y
  corre `deploy.sh` solo para ese servicio:

  | Repo | Servicios |
  |---|---|
  | API (`CATALOGO-JDH-API`) | `api-migrate api` |
  | UI (`CATALOGO-JDH-UI`) | `ui-auth-migrate ui` |

  Los dos comparten el stack, así que el paso entero corre bajo
  `flock ~/apps/.deploy.lock`: dos despliegues nunca construyen ni respaldan a
  la vez.

El runner sale hacia GitHub (HTTPS); no se abre ningún puerto. Los clones se
actualizan con **deploy keys de solo lectura**, una por repo (GitHub no permite
reusar una deploy key entre repos).

### Configuración (una sola vez)

`deploy/scripts/setup-cicd.sh`, como `tienda` en el servidor:

1. **Deploy keys.** `setup-cicd.sh keys` genera
   `~/.ssh/deploy_catalogo_jdh_{api,ui}` y los alias `github-catalogo-jdh-*` en
   `~/.ssh/config`, e imprime las claves públicas. Un admin de cada repo las
   registra en *Settings → Deploy keys → Add deploy key*, **sin** *Allow write
   access*. Las privadas no salen del servidor.
2. **Clones.** `setup-cicd.sh clones` convierte `~/apps/<repo>` en clones de
   `master`. Lo que difiera de `origin/master` queda en un `git stash`;
   `deploy/.env` y la CA no se tocan (están ignorados). Requiere que el stack
   (`deploy/`) ya esté en `master` (mergear primero el PR `deployment-configs`).
3. **Runner.** Un owner de la org crea el token en *github.com/JDHTI →
   Settings → Actions → Runners → New runner* y corre
   `setup-cicd.sh runner https://github.com/JDHTI <token>`. Sin acceso de
   owner, se registra uno por repo (*repo → Settings → Actions → Runners*) con
   la URL de cada repo; cada uno queda en `~/actions-runner/<repo>`. Instala el
   servicio con `sudo`.
4. **Ambiente.** Cada repo usa el ambiente `produccion` (se crea solo en el
   primer despliegue). Para exigir aprobación antes de desplegar: *Settings →
   Environments → produccion → Required reviewers*.

Diagnóstico del runner: `sudo ~/actions-runner/<org-o-repo>/svc.sh status` y
`journalctl -u 'actions.runner.*' -n 100`.

## Respaldos

`deploy/scripts/backup.sh [etiqueta]` guarda en `~/backups/<fecha>-<etiqueta>/`
los dumps de `jdh_catalogo` y `jdh_auth` (`pg_dump -Fc`) y el bucket de
imágenes. Conserva 14 diarios y 10 pre-deploy. Cron instalado por
`bootstrap-server.sh` (usuario `tienda`):

```
30 2 * * * ~/apps/CATALOGO-JDH-API/deploy/scripts/backup.sh daily >> ~/backups/backup.log 2>&1
```

**Pendiente**: copiar `~/backups` fuera de la VM (NAS o bucket R2), junto con
`deploy/.env` y `deploy/caddy/ca/root.key`, que no son recuperables de otra
forma. Redis es caché: no se respalda.

Restaurar una base: `deploy/scripts/restore.sh jdh_catalogo ~/backups/<dir>/jdh_catalogo.dump`
(para y reinicia API y UI; pide confirmación).

## Almacenamiento: local y no Cloudflare R2

- Las imágenes (productos, logos, banners) las sirve este servidor desde
  `https://tienda.jdh.local/media/<clave>`. El bucket tiene política de
  descarga anónima; Caddy solo deja pasar GET/HEAD/OPTIONS y la API escribe por
  la red interna con credenciales propias.
- La imagen de MinIO ya no se publica en Docker Hub; se usa **RustFS**
  (compatible con S3, sin cambios de código). Pasar a R2/S3 es configuración:
  `S3_ENDPOINT`, credenciales, bucket y `S3_PUBLIC_URL` (y
  `NEXT_PUBLIC_ASSETS_CDN_URL` en la UI).
- La UI optimiza las imágenes de `/media` desde su propio contenedor, que ve
  el bucket como una IP privada de Docker: por eso se construye con
  `ALLOW_LOCAL_IMAGE_HOSTS=1` (Next 16 lo bloquea por defecto como defensa
  SSRF). Es correcto aquí porque el bucket es de la LAN; nunca en un bucket
  público de internet.

## Autenticación entre UI y API

La API no emite tokens ni toca `jdh_auth`: verifica el JWT EdDSA que firma la
UI con su JWKS (`AUTH_JWKS_URL=http://ui:3000/api/auth/jwks`, red interna).
`BETTER_AUTH_SECRET` cifra la clave privada de la tabla `jwks`; **rotarlo exige
`TRUNCATE TABLE jwks;`** en `jdh_auth` o la firma falla con «Failed to decrypt
private key».

## Diagnóstico

```bash
C="docker compose -f deploy/compose.prod.yaml --env-file deploy/.env"
$C ps
$C logs --tail 100 api        # ui, caddy, postgres, ...
docker exec tienda-ui wget -qO- http://api:8080/api/v1/health      # estado de dependencias
curl --cacert deploy/caddy/ca/root.crt --resolve tienda.jdh.local:443:127.0.0.1 https://tienda.jdh.local/api/v1/products?limit=1
```
