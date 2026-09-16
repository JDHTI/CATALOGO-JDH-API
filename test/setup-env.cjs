// Solo pruebas unitarias: evita que los imports de ConfigModule exijan .env real.
const defaults = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '1',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_BUCKET: 'test',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  SYNC_PRODUCTS_ENABLED: 'false',
};
for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;
