import type { ConfigService } from '@nestjs/config';

import type { MailConfig } from '@infrastructure/config';

import { MailService } from './mail.service';

const CONFIG: MailConfig = {
  enabled: true,
  tenantId: 'tenant',
  clientId: 'client',
  clientSecret: 'secreto',
  from: 'info@jdh.com.co',
  orderTo: [],
  orderCcCustomer: true,
  timeoutMs: 1000,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function build(config: Partial<MailConfig>, http: jest.Mock) {
  return new MailService(
    {
      getOrThrow: () => ({ ...CONFIG, ...config }),
    } as unknown as ConfigService,
    http,
  );
}

const MESSAGE = {
  to: ['Pedidos@JDH.com.co'],
  cc: ['ana@jdh.com.co', 'pedidos@jdh.com.co'],
  subject: 'Pedido',
  html: '<p>hola</p>',
};

describe('MailService', () => {
  it('apagado sin credenciales: no sale a la red', async () => {
    const http = jest.fn();
    const result = await build({ enabled: false }, http).send(MESSAGE);

    expect(result.status).toBe('deshabilitado');
    expect(http).not.toHaveBeenCalled();
  });

  it('pide solo el scope .default y envía con sendMail desde MAIL_FROM', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(
        json(200, { access_token: 'tok', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const service = build({}, http);

    await expect(service.send(MESSAGE)).resolves.toEqual({ status: 'enviado' });

    const [tokenUrl, tokenInit] = http.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe(
      'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
    );
    const form = new URLSearchParams(tokenInit.body as string);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('https://graph.microsoft.com/.default');

    const [sendUrl, sendInit] = http.mock.calls[1] as [string, RequestInit];
    expect(sendUrl).toBe(
      'https://graph.microsoft.com/v1.0/users/info%40jdh.com.co/sendMail',
    );
    expect(sendInit.method).toBe('POST');
    expect((sendInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
    const payload = JSON.parse(sendInit.body as string) as {
      message: {
        toRecipients: { emailAddress: { address: string } }[];
        ccRecipients: { emailAddress: { address: string } }[];
        body: { contentType: string };
      };
    };
    expect(payload.message.body.contentType).toBe('HTML');
    expect(payload.message.toRecipients).toEqual([
      { emailAddress: { address: 'pedidos@jdh.com.co' } },
    ]);
    // El destinatario principal no se repite en copia.
    expect(payload.message.ccRecipients).toEqual([
      { emailAddress: { address: 'ana@jdh.com.co' } },
    ]);
  });

  it('reutiliza el token mientras no caduque', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(
        json(200, { access_token: 'tok', expires_in: 3600 }),
      )
      .mockResolvedValue(new Response(null, { status: 202 }));
    const service = build({}, http);

    await service.send(MESSAGE);
    await service.send(MESSAGE);

    expect(http).toHaveBeenCalledTimes(3);
  });

  it('un 403 de Graph vuelve como error, sin lanzar', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(
        json(200, { access_token: 'tok', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        json(403, { error: { code: 'ErrorAccessDenied' } }),
      );

    const result = await build({}, http).send(MESSAGE);

    expect(result).toMatchObject({ status: 'error' });
    expect(result.status === 'error' && result.error).toMatch(
      /403.*ErrorAccessDenied/,
    );
  });

  it('un fallo de Entra no filtra el secreto en el error', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(json(401, { error: 'invalid_client' }));

    const result = await build({}, http).send(MESSAGE);

    expect(result.status === 'error' && result.error).toMatch(/invalid_client/);
    expect(JSON.stringify(result)).not.toContain('secreto');
  });
});
