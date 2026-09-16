import databaseConfig from './database.config';
import redisConfig from './redis.config';
import appConfig from './app.config';
import { validateEnv } from './env.validation';

describe('límites de capacidad', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    'DATABASE_POOL_MAX',
    'DATABASE_CONNECTION_TIMEOUT',
    'DATABASE_STATEMENT_TIMEOUT',
    'REDIS_COMMAND_TIMEOUT',
    'REDIS_CONNECT_TIMEOUT',
    'REDIS_DEFAULT_TTL',
    'HTTP_MAX_INFLIGHT',
  ])(
    'rechaza %s=0 para evitar límites deshabilitados accidentalmente',
    (key) => {
      expect(() => validateEnv({ ...process.env, [key]: '0' })).toThrow(key);
    },
  );

  it('las variables vacías conservan los límites por defecto validados', () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      DATABASE_POOL_MAX: '',
      DATABASE_CONNECTION_TIMEOUT: '',
      DATABASE_STATEMENT_TIMEOUT: '',
      REDIS_COMMAND_TIMEOUT: '',
      REDIS_CONNECT_TIMEOUT: '',
      REDIS_DEFAULT_TTL: '',
      HTTP_MAX_INFLIGHT: '',
    });
    const validated = validateEnv(process.env);
    expect(databaseConfig().poolMax).toBe(validated.DATABASE_POOL_MAX);
    expect(databaseConfig().connectionTimeoutMillis).toBe(
      validated.DATABASE_CONNECTION_TIMEOUT,
    );
    expect(databaseConfig().statementTimeoutMillis).toBe(
      validated.DATABASE_STATEMENT_TIMEOUT,
    );
    expect(redisConfig().commandTimeout).toBe(validated.REDIS_COMMAND_TIMEOUT);
    expect(redisConfig().connectTimeout).toBe(validated.REDIS_CONNECT_TIMEOUT);
    expect(redisConfig().defaultTtl).toBe(validated.REDIS_DEFAULT_TTL);
    expect(appConfig().maxInflightRequests).toBe(validated.HTTP_MAX_INFLIGHT);
  });
});
