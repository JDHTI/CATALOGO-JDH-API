import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  /**
   * URL del JWKS de la UI (`{origen de la UI}/api/auth/jwks`), del MISMO
   * entorno. Vacía = autenticación deshabilitada: los endpoints privados
   * responden 503 y el catálogo público sigue funcionando igual.
   */
  jwksUrl?: string;
  /** Emisor esperado del token. Identificador lógico, NO una URL alcanzable. */
  issuer: string;
  /** Audiencia esperada: este API. Se verifica siempre, no solo la firma. */
  audience: string;
}

export const AUTH_CONFIG = 'auth';

export default registerAs<AuthConfig>(AUTH_CONFIG, () => ({
  jwksUrl: process.env.AUTH_JWKS_URL || undefined,
  issuer: process.env.AUTH_JWT_ISSUER ?? 'jdh-catalogo-ui',
  audience: process.env.AUTH_JWT_AUDIENCE ?? 'jdh-catalogo-api',
}));
