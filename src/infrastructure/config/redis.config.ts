import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
  defaultTtl: number;
}

export const REDIS_CONFIG = 'redis';

export default registerAs<RedisConfig>(REDIS_CONFIG, () => ({
  host: process.env.REDIS_HOST as string,
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB ?? 0),
  keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'jdh:catalogo:',
  defaultTtl: Number(process.env.REDIS_DEFAULT_TTL ?? 300),
}));
