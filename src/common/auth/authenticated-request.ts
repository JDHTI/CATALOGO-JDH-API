import type { Request } from 'express';

/**
 * Identidad que el guard deja en la petición.
 *
 * Solo el `sub` del JWT. El token trae además `clienteId` y `listaPrecioId`,
 * pero son REFERENCIAS a verificar contra el ERP, no permisos concedidos: no
 * se propagan aquí para que nadie los confunda con autorización.
 */
export interface AuthenticatedUser {
  /**
   * Claim `sub`. String OPACO: el catálogo no tiene acceso a la base
   * `jdh_auth` de la UI y no puede resolverlo a una cuenta.
   */
  sub: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
