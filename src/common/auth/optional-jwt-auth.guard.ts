import {
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthenticatedRequest } from './authenticated-request';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Variante del `JwtAuthGuard` para rutas PÚBLICAS que muestran algo más a
 * quien viene identificado (hoy: el precio de empleados en `/products`).
 *
 * - Sin `Authorization`: pasa como anónimo (`request.user` queda vacío).
 * - Con un token inválido o caducado: 401, igual que el guard estricto. Quien
 *   manda un token espera que cuente; tratarlo como anónimo escondería un
 *   fallo de la UI.
 * - Con un token pero sin poder verificarlo (falta `AUTH_JWKS_URL` o el JWKS
 *   no responde): pasa como anónimo. El catálogo público no se cae por un
 *   problema de la UI; el empleado solo deja de ver su precio.
 */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  private readonly logger = new Logger(OptionalJwtAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = JwtAuthGuard.extractBearer(request.headers.authorization);
    if (!token) return true;

    if (!this.jwks) {
      this.logger.warn(
        'Token recibido sin AUTH_JWKS_URL: se atiende como anónimo',
      );
      return true;
    }

    try {
      request.user = await this.verify(token, this.jwks);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.warn(
        `No se pudo verificar el token, se atiende como anónimo: ${(error as Error).message}`,
      );
    }
    return true;
  }
}
