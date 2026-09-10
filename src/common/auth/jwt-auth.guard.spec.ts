import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import type { AuthConfig } from '@infrastructure/config';

import type { AuthenticatedRequest } from './authenticated-request';
import { JwtAuthGuard } from './jwt-auth.guard';

const JWKS_URL = 'https://ui.jdh.test/api/auth/jwks';
const ISSUER = 'jdh-catalogo-ui';
const AUDIENCE = 'jdh-catalogo-api';
const KID = 'test-key';

describe('JwtAuthGuard', () => {
  let keys: CryptoKeyPair;
  let jwks: string;

  beforeAll(async () => {
    keys = await generateKeyPair('EdDSA', {
      crv: 'Ed25519',
      extractable: true,
    });
    const publicJwk = await exportJWK(keys.publicKey);
    jwks = JSON.stringify({
      keys: [{ ...publicJwk, kid: KID, alg: 'EdDSA', use: 'sig' }],
    });
  });

  beforeEach(() => {
    // `createRemoteJWKSet` descarga la clave pública con `fetch`; aquí se
    // sirve el JWKS en memoria para poder firmar de verdad en el test.
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(jwks, {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  const signToken = (
    overrides: { issuer?: string; audience?: string; expiresAt?: string } = {},
  ): Promise<string> =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA', kid: KID })
      .setSubject('usuario-opaco-123')
      .setIssuer(overrides.issuer ?? ISSUER)
      .setAudience(overrides.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(overrides.expiresAt ?? '5m')
      .sign(keys.privateKey);

  const buildGuard = (auth: Partial<AuthConfig> = {}): JwtAuthGuard => {
    const config = {
      getOrThrow: (): AuthConfig => ({
        jwksUrl: JWKS_URL,
        issuer: ISSUER,
        audience: AUDIENCE,
        ...auth,
      }),
    } as unknown as ConfigService;

    return new JwtAuthGuard(config);
  };

  const buildContext = (
    authorization?: string,
  ): { context: ExecutionContext; request: AuthenticatedRequest } => {
    const request = { headers: { authorization } } as AuthenticatedRequest;
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { context, request };
  };

  it('acepta un token válido y deja el `sub` en la petición', async () => {
    const { context, request } = buildContext(`Bearer ${await signToken()}`);

    await expect(buildGuard().canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ sub: 'usuario-opaco-123' });
  });

  it('rechaza un token emitido para otra audiencia', async () => {
    const token = await signToken({ audience: 'otro-consumidor' });
    const { context } = buildContext(`Bearer ${token}`);

    await expect(buildGuard().canActivate(context)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rechaza un token de otro emisor', async () => {
    const token = await signToken({ issuer: 'quien-sea' });
    const { context } = buildContext(`Bearer ${token}`);

    await expect(buildGuard().canActivate(context)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rechaza un token caducado', async () => {
    const token = await signToken({ expiresAt: '-1m' });
    const { context } = buildContext(`Bearer ${token}`);

    await expect(buildGuard().canActivate(context)).rejects.toMatchObject({
      status: 401,
    });
  });

  it.each([
    ['sin cabecera', undefined],
    ['con otro esquema', 'Basic dXNlcjpwYXNz'],
    ['con Bearer vacío', 'Bearer '],
  ])('responde 401 %s', async (_caso, authorization) => {
    const { context } = buildContext(authorization);

    await expect(buildGuard().canActivate(context)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('responde 503 (no 401) si falta AUTH_JWKS_URL', async () => {
    const { context } = buildContext(`Bearer ${await signToken()}`);

    await expect(
      buildGuard({ jwksUrl: undefined }).canActivate(context),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('responde 503 (no 401) si el JWKS no responde', async () => {
    const token = await signToken();
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    const { context } = buildContext(`Bearer ${token}`);

    await expect(buildGuard().canActivate(context)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('ignora contextos que no son HTTP', async () => {
    const context = { getType: () => 'rpc' } as unknown as ExecutionContext;

    await expect(buildGuard().canActivate(context)).resolves.toBe(true);
  });
});
