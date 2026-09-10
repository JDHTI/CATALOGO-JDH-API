import {
  createParamDecorator,
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';

import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Inyecta el `sub` del JWT verificado.
 *
 * Solo tiene sentido detrás de `@UseGuards(JwtAuthGuard)`; si el handler se
 * declara sin el guard, esto revienta con 500 en vez de colar `undefined`
 * como identidad de usuario y mezclar los favoritos de todo el mundo.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sub = request.user?.sub;

    if (!sub) {
      throw new InternalServerErrorException(
        'Ruta con @CurrentUser() pero sin JwtAuthGuard',
      );
    }

    return sub;
  },
);
