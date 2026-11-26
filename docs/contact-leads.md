# Contactos de la home (`POST /contact-leads`)

Formulario público tipo newsletter de la home del catálogo. Por ahora el API
solo guarda los datos; qué hacer con ellos se decide después. No hay
endpoint de lectura: se consultan en la tabla `contact_leads`.

La UI lo llama desde una Server Action de Next (servidor a servidor, sin JWT)
contra `BACKEND_API_URL`.

## Contrato

`POST /api/v1/contact-leads`, sin autenticación.

```json
{
  "nombre": "Ana Gómez",
  "correo": "ana@example.com",
  "celular": "+57 300 123 4567",
  "ciudad": "Medellín",
  "tipoIdentificacion": "NIT",
  "identificacion": "900123456-7",
  "aceptaTratamientoDatos": true,
  "origen": "home-newsletter"
}
```

| Campo | Regla | Se guarda |
| --- | --- | --- |
| `nombre` | 2 a 120 caracteres tras `trim` | sin espacios en los extremos |
| `correo` | email, máximo 254 | en minúsculas |
| `celular` | celular colombiano: 10 dígitos que empiezan por 3. Acepta `+57`/`57`, espacios, guiones, puntos y paréntesis | 10 dígitos, sin indicativo |
| `ciudad` | 2 a 80 caracteres tras `trim` | sin espacios en los extremos |
| `tipoIdentificacion` | `NIT`, `CC` o `null` | igual |
| `identificacion` | 5 a 15 dígitos; un NIT puede terminar en `-DV`. Se toleran puntos y espacios | sin puntos ni espacios (`900123456-7`) |
| `aceptaTratamientoDatos` | debe ser `true` (autorización Ley 1581) | fecha en `acepta_tratamiento_at` |
| `origen` | identificador corto: `a-z`, `0-9` y guion, hasta 40 | igual |

- `tipoIdentificacion` e `identificacion` van juntos: llega uno sin el otro → 400.
  Un `""` cuenta como no enviado.
- Campos fuera del contrato → 400 (`forbidNonWhitelisted` global).

### Respuestas

- `201 { "id": number }`, también cuando el correo ya existía.
- `400` con el formato del filtro global: `{ statusCode, message, error, path, timestamp }`;
  `message` es un arreglo con los errores de validación.
- `429` cuando la IP supera la cuota (con `Retry-After`).

## Correo repetido

Un registro por correo (`correo` único). Si el correo ya existe se
reemplazan sus datos, la fecha de autorización, la IP y el user agent, y la
respuesta es la misma, para no revelar qué correos están registrados. Prisma
lo resuelve con `INSERT ... ON CONFLICT`, así que dos envíos simultáneos no
chocan.

## Rate limit

Además de la cuota global (`RATE_LIMIT_MAX` por `RATE_LIMIT_TTL`), la ruta
tiene una propia: **5 envíos cada 10 minutos por IP**
(`CONTACT_LEADS_RATE_LIMIT`). Se declara con `@RateLimit({ name, max, ttl })`,
que sirve para cualquier otra ruta sensible; el contador vive en
`ratelimit:<name>:<ip>`. Los headers `X-RateLimit-*` muestran la cuota de la
ruta.

## IP del visitante

Detrás de la Server Action la conexión llega desde el servidor de Next. La
UI reenvía la IP del visitante en `X-Forwarded-For`, y el API la usa solo si
la conexión viene de un proxy en `TRUST_PROXY` (en producción, la subred de
compose, donde está el contenedor `ui`). Sin `TRUST_PROXY` se guarda la IP
de la conexión, es decir, la del servidor de Next, y la cuota por IP se
vuelve compartida entre todos los visitantes.

## Desplegar

`prisma migrate deploy` aplica `20261126120000_contact_leads`. No hay
variables nuevas.
