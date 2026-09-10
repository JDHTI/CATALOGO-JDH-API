import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

import { AUTH_CONFIG, type AuthConfig } from '@infrastructure/config';

import type { AuthenticatedRequest } from './authenticated-request';

/** Único algoritmo aceptado: Ed25519 asimétrico (la UI firma, este API solo verifica). */
const ALGORITHMS = ['EdDSA'];

/**
 * Margen de reloj entre la UI y este API. Los tokens viven 5 minutos, así que
 * unos segundos de desfase entre contenedores no deberían traducirse en un
 * 401 que la UI leería como sesión caducada.
 */
const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Verifica el JWT que emite la UI (`jdh-catalogo-ui`) y deja el `sub` en
 * `request.user`.
 *
 * Es OPT-IN: se declara con `@UseGuards(JwtAuthGuard)` en el controlador o
 * handler que lo necesita. NO se registra como `APP_GUARD` — el catálogo
 * (`/products`, `/suppliers`, `/brands`) es público y la UI lo consume sin
 * sesión.
 *
 * La clave pública se descarga del JWKS de la UI y `jose` la cachea, así que
 * verificar no añade una llamada de red por petición. Este API nunca ve la
 * clave privada ni toca la base `jdh_auth`: esa separación es justo la razón
 * de que la firma sea asimétrica.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly auth: AuthConfig;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: ConfigService) {
    this.auth = config.getOrThrow<AuthConfig>(AUTH_CONFIG);
    this.jwks = this.auth.jwksUrl
      ? createRemoteJWKSet(new URL(this.auth.jwksUrl))
      : undefined;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    // Sin JWKS configurado no se puede verificar nada. Fallamos cerrado y con
    // un código distinguible: un 401 aquí haría que la UI cerrara la sesión
    // del usuario por un problema de configuración del servidor.
    if (!this.jwks) {
      throw new ServiceUnavailableException(
        'Autenticación no configurada en el API: falta AUTH_JWKS_URL',
      );
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = JwtAuthGuard.extractBearer(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Falta el token de autenticación');
    }

    let sub: string | undefined;
    try {
      // `audience` no es opcional: sin verificarla, un token emitido para otro
      // consumidor de la misma UI valdría aquí.
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.auth.issuer,
        audience: this.auth.audience,
        algorithms: ALGORITHMS,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      sub = payload.sub;
    } catch (error) {
      throw JwtAuthGuard.toHttpError(error);
    }

    if (!sub) {
      throw new UnauthorizedException('El token no identifica a un usuario');
    }

    request.user = { sub };
    return true;
  }

  /** `Authorization: Bearer <token>` → token, o `null` si no viene así. */
  private static extractBearer(header?: string): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value.trim() || null;
  }

  /**
   * Token inválido → 401. JWKS inalcanzable → 503.
   *
   * La distinción importa: si la UI está caída o lenta, el token del usuario
   * sigue siendo bueno y devolver 401 provocaría un cierre de sesión en
   * cascada por un fallo que no es suyo.
   */
  private static toHttpError(error: unknown): Error {
    const isVerificationFailure =
      error instanceof errors.JOSEError && error.code !== 'ERR_JWKS_TIMEOUT';

    return isVerificationFailure
      ? new UnauthorizedException('Token de autenticación inválido')
      : new ServiceUnavailableException(
          'No se pudo verificar el token: JWKS inalcanzable',
        );
  }
}
