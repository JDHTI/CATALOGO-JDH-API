import type { Request } from 'express';

/**
 * Identidad que el guard deja en la petición.
 *
 * El `sub` y la marca `empleado` del JWT. El token trae además `clienteId` y `listaPrecioId`,
 * pero son REFERENCIAS a verificar contra el ERP, no permisos concedidos: no
 * se propagan aquí para que nadie los confunda con autorización.
 */
export interface AuthenticatedUser {
  /**
   * Claim `sub`. String OPACO: el catálogo no tiene acceso a la base
   * `jdh_auth` de la UI y no puede resolverlo a una cuenta.
   */
  sub: string;
  /**
   * Claim `empleado` del JWT: `true` solo si la sesión de la UI viene del
   * login con Entra (tenant JDH). Habilita la lista de precios de empleados;
   * no es un rol ni concede nada más.
   */
  empleado: boolean;
  /**
   * Claims `name` y `email` del JWT (los firma la UI desde la sesión: para un
   * empleado, el nombre y el correo de Entra). Solo se usan para identificar
   * al solicitante de un pedido; nunca como permiso.
   */
  name?: string;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
