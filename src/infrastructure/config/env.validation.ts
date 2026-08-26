import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

const toNumber = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === '' ? undefined : Number(value);

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
};

/**
 * Contrato de variables de entorno de la aplicación.
 * Si alguna falta o es inválida el proceso falla al arrancar (fail-fast).
 */
export class EnvironmentVariables {
  // ---------------------------------------------------------------- aplicación
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api';

  @IsString()
  @IsOptional()
  API_VERSION: string = 'v1';

  // ------------------------------------------------------------------ database
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsBoolean()
  @IsOptional()
  DATABASE_LOG_QUERIES: boolean = false;

  // ------------------------------------------------------------- datawarehouse
  // Todas opcionales: el DWH solo se necesita para importar/sincronizar datos,
  // no para arrancar la API. Sin `DWH_HOST` la conexión queda deshabilitada.
  @IsString()
  @IsOptional()
  DWH_HOST?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  DWH_PORT: number = 5432;

  @IsString()
  @IsOptional()
  DWH_DATABASE?: string;

  @IsString()
  @IsOptional()
  DWH_USER?: string;

  @IsString()
  @IsOptional()
  DWH_PASSWORD?: string;

  @IsString()
  @IsOptional()
  DWH_SCHEMA: string = 'public';

  @IsBoolean()
  @IsOptional()
  DWH_SSL: boolean = false;

  @IsInt()
  @Min(1)
  @IsOptional()
  DWH_POOL_MAX: number = 10;

  @IsInt()
  @IsOptional()
  DWH_POOL_IDLE_TIMEOUT: number = 30_000;

  @IsInt()
  @IsOptional()
  DWH_CONNECTION_TIMEOUT: number = 10_000;

  @IsInt()
  @IsOptional()
  DWH_STATEMENT_TIMEOUT: number = 60_000;

  // --------------------------------------------------------------------- redis
  @IsString()
  @IsNotEmpty()
  REDIS_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT!: number;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  REDIS_DB: number = 0;

  @IsString()
  @IsOptional()
  REDIS_KEY_PREFIX: string = 'jdh:catalogo:';

  @IsInt()
  @Min(0)
  @IsOptional()
  REDIS_DEFAULT_TTL: number = 300;

  // ---------------------------------------------------------- sincronizaciones
  /** Expresión cron de la sincronización de productos desde el DWH. */
  @IsString()
  @IsOptional()
  SYNC_PRODUCTS_CRON: string = '0 2 * * *';

  /** Permite apagar la sincronización programada. */
  @IsBoolean()
  @IsOptional()
  SYNC_PRODUCTS_ENABLED: boolean = true;

  // ------------------------------------------------------------- rate limiting
  /** Tamaño de la ventana de rate limiting, en segundos. */
  @IsInt()
  @Min(1)
  @IsOptional()
  RATE_LIMIT_TTL: number = 60;

  /** Máximo de peticiones por IP dentro de la ventana. */
  @IsInt()
  @Min(1)
  @IsOptional()
  RATE_LIMIT_MAX: number = 100;

  // ------------------------------------------------------------------- storage
  @IsUrl({ require_tld: false })
  S3_ENDPOINT!: string;

  @IsString()
  @IsOptional()
  S3_REGION: string = 'us-east-1';

  @IsString()
  @IsNotEmpty()
  S3_BUCKET!: string;

  @IsString()
  @IsNotEmpty()
  S3_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  S3_SECRET_ACCESS_KEY!: string;

  @IsBoolean()
  @IsOptional()
  S3_FORCE_PATH_STYLE: boolean = true;

  @IsString()
  @IsOptional()
  S3_PUBLIC_URL?: string;
}

const NUMERIC_KEYS = [
  'PORT',
  'DWH_PORT',
  'DWH_POOL_MAX',
  'DWH_POOL_IDLE_TIMEOUT',
  'DWH_CONNECTION_TIMEOUT',
  'DWH_STATEMENT_TIMEOUT',
  'REDIS_PORT',
  'REDIS_DB',
  'REDIS_DEFAULT_TTL',
  'RATE_LIMIT_TTL',
  'RATE_LIMIT_MAX',
] as const;

const BOOLEAN_KEYS = [
  'DATABASE_LOG_QUERIES',
  'DWH_SSL',
  'S3_FORCE_PATH_STYLE',
  'SYNC_PRODUCTS_ENABLED',
] as const;

export function validateEnv(
  raw: Record<string, unknown>,
): EnvironmentVariables {
  const normalized: Record<string, unknown> = { ...raw };

  for (const key of NUMERIC_KEYS) {
    normalized[key] = toNumber({ value: raw[key] });
  }
  for (const key of BOOLEAN_KEYS) {
    normalized[key] = toBoolean({ value: raw[key] });
  }
  for (const key of Object.keys(normalized)) {
    if (normalized[key] === undefined) delete normalized[key];
  }

  const config = plainToInstance(EnvironmentVariables, normalized, {
    excludeExtraneousValues: false,
    exposeDefaultValues: true,
  });

  const errors = validateSync(config, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${details}`);
  }

  return config;
}
