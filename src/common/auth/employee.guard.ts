import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Solo empleados JDH (claim `empleado: true`). Va DESPUÉS de `JwtAuthGuard`
 * (`@UseGuards(JwtAuthGuard, EmployeeGuard)`), que es quien verifica el token
 * y deja la identidad en la petición. Un cliente autenticado recibe 403, no
 * 401: su sesión es válida, solo que esta superficie no es para él.
 */
@Injectable()
export class EmployeeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.empleado !== true) {
      throw new ForbiddenException('Solo para empleados JDH');
    }
    return true;
  }
}
