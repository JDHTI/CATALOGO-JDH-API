import { registerAs } from '@nestjs/config';

/**
 * Envío de correo por Microsoft Graph (`POST /users/{MAIL_FROM}/sendMail`) con
 * client credentials de una app de Entra. Solo se pide el scope
 * `https://graph.microsoft.com/.default` y solo se envía: nunca se lee un
 * buzón.
 *
 * Si falta cualquiera de las credenciales o `MAIL_FROM`, o con
 * `MAIL_DISABLED=true`, el envío queda APAGADO: los pedidos se registran
 * igual con el correo en `deshabilitado`.
 * Ver docs/carrito-pedidos.md.
 */
export interface MailConfig {
  enabled: boolean;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  /** Buzón remitente (p. ej. info@jdh.com.co). */
  from?: string;
  /** Buzones internos que reciben los pedidos (separados por coma). */
  orderTo: string[];
  /** Copia al empleado que hizo el pedido. */
  orderCcCustomer: boolean;
  /** Timeout por petición a Entra/Graph. */
  timeoutMs: number;
}

export const MAIL_CONFIG = 'mail';

export default registerAs<MailConfig>(MAIL_CONFIG, () => {
  const tenantId = process.env.MAIL_GRAPH_TENANT_ID || undefined;
  const clientId = process.env.MAIL_GRAPH_CLIENT_ID || undefined;
  const clientSecret = process.env.MAIL_GRAPH_CLIENT_SECRET || undefined;
  const from = process.env.MAIL_FROM || undefined;

  return {
    // `MAIL_DISABLED=true` apaga el envío aunque haya credenciales (pruebas,
    // contingencias). Una variable vacía NO sirve para eso: el `.env` la
    // completa.
    enabled:
      process.env.MAIL_DISABLED !== 'true' &&
      Boolean(tenantId && clientId && clientSecret && from),
    tenantId,
    clientId,
    clientSecret,
    from,
    orderTo: (process.env.ORDER_EMAIL_TO ?? '')
      .split(',')
      .map((address) => address.trim())
      .filter(Boolean),
    orderCcCustomer: process.env.ORDER_EMAIL_CC_CUSTOMER !== 'false',
    timeoutMs: Number(process.env.MAIL_TIMEOUT_MS) || 15_000,
  };
});
