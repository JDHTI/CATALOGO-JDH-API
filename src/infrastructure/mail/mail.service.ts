import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MAIL_CONFIG, type MailConfig } from '@infrastructure/config';

export interface MailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
}

/** Resultado de un envío; nunca lanza por un fallo de Graph. */
export type MailResult =
  | { status: 'enviado' }
  | { status: 'deshabilitado'; reason: string }
  | { status: 'error'; error: string };

/** Token opcional para inyectar un `fetch` falso en tests. */
export const MAIL_HTTP_CLIENT = Symbol('MAIL_HTTP_CLIENT');

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
/** Margen antes de que caduque el token para no usarlo en el límite. */
const TOKEN_MARGIN_MS = 60_000;

/**
 * Correo saliente por Microsoft Graph con client credentials.
 *
 * Solo envía (`sendMail`) desde `MAIL_FROM`; nunca lee buzones. El token de
 * aplicación se cachea en memoria hasta un minuto antes de caducar. Un fallo
 * de Entra o Graph se devuelve como `{ status: 'error' }`: quien llama decide
 * (un pedido se registra igual y su correo queda en error para reintentar).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly config: MailConfig;
  private token?: { value: string; expiresAt: number };

  private readonly http: typeof fetch;

  constructor(
    config: ConfigService,
    @Optional() @Inject(MAIL_HTTP_CLIENT) http?: typeof fetch,
  ) {
    this.config = config.getOrThrow<MailConfig>(MAIL_CONFIG);
    this.http = http ?? ((input, init) => fetch(input, init));
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get settings(): Pick<MailConfig, 'from' | 'orderTo' | 'orderCcCustomer'> {
    return {
      from: this.config.from,
      orderTo: this.config.orderTo,
      orderCcCustomer: this.config.orderCcCustomer,
    };
  }

  async send(message: MailMessage): Promise<MailResult> {
    if (!this.config.enabled) {
      return {
        status: 'deshabilitado',
        reason:
          'Envío apagado: MAIL_DISABLED=true o faltan MAIL_GRAPH_* / MAIL_FROM',
      };
    }
    const to = unique(message.to);
    if (to.length === 0) {
      return { status: 'deshabilitado', reason: 'Sin destinatarios' };
    }

    try {
      const token = await this.accessToken();
      const response = await this.http(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.config.from!)}/sendMail`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              subject: message.subject,
              body: { contentType: 'HTML', content: message.html },
              toRecipients: to.map(recipient),
              ccRecipients: unique(message.cc ?? [])
                .filter((address) => !to.includes(address))
                .map(recipient),
            },
            saveToSentItems: true,
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
      // Graph responde 202 sin cuerpo cuando acepta el envío.
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (response.status === 401) this.token = undefined;
        return {
          status: 'error',
          error: `Graph sendMail ${response.status}: ${detail.slice(0, 500)}`,
        };
      }
      return { status: 'enviado' };
    } catch (error) {
      const text = (error as Error).message;
      this.logger.warn(`No se pudo enviar el correo: ${text}`);
      return { status: 'error', error: text.slice(0, 500) };
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_MARGIN_MS > Date.now()) {
      return this.token.value;
    }
    const response = await this.http(
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId!)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.clientId!,
          client_secret: this.config.clientSecret!,
          scope: GRAPH_SCOPE,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      // Sin el secreto ni el token en el mensaje: solo el código de Entra.
      throw new Error(
        `Entra token ${response.status}: ${body.error ?? 'sin access_token'}`,
      );
    }
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }
}

function recipient(address: string) {
  return { emailAddress: { address } };
}

function unique(addresses: string[]): string[] {
  return [
    ...new Set(
      addresses.map((address) => address.trim().toLowerCase()).filter(Boolean),
    ),
  ];
}
