import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { REDIS_CONFIG, type RedisConfig } from '@infrastructure/config';

/**
 * Caché de la API sobre Redis.
 * Los errores de Redis nunca rompen la petición: la caché es un acelerador,
 * no una fuente de verdad.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis;
  private readonly defaultTtl: number;

  constructor(config: ConfigService) {
    const redis = config.getOrThrow<RedisConfig>(REDIS_CONFIG);
    this.defaultTtl = redis.defaultTtl;

    this.client = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      db: redis.db,
      keyPrefix: redis.keyPrefix,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });

    this.client.on('error', (error) =>
      this.logger.warn(`Error de Redis: ${error.message}`),
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Conexión establecida con Redis');
    } catch (error) {
      this.logger.warn(
        `Redis no disponible al iniciar: ${(error as Error).message}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }

  /** Cliente crudo, para casos que necesiten comandos específicos. */
  get raw(): Redis {
    return this.client;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value === null ? null : (JSON.parse(value) as T);
    } catch (error) {
      this.logger.warn(`Fallo al leer "${key}": ${(error as Error).message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      await this.client.set(
        key,
        JSON.stringify(value),
        'EX',
        ttlSeconds ?? this.defaultTtl,
      );
    } catch (error) {
      this.logger.warn(
        `Fallo al escribir "${key}": ${(error as Error).message}`,
      );
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (error) {
      this.logger.warn(`Fallo al borrar claves: ${(error as Error).message}`);
    }
  }

  /** Borra por patrón usando SCAN (nunca KEYS, que bloquea el servidor). */
  async delByPattern(pattern: string): Promise<number> {
    const prefix = this.client.options.keyPrefix ?? '';
    let deleted = 0;

    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.client.scan(
          cursor,
          'MATCH',
          `${prefix}${pattern}`,
          'COUNT',
          250,
        );
        cursor = next;

        if (keys.length > 0) {
          // SCAN devuelve claves con prefijo; el cliente lo vuelve a añadir.
          await this.client.del(...keys.map((key) => key.slice(prefix.length)));
          deleted += keys.length;
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(
        `Fallo al invalidar el patrón "${pattern}": ${(error as Error).message}`,
      );
    }

    return deleted;
  }

  /** Devuelve el valor en caché o lo calcula y lo almacena. */
  async wrap<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /** Alias semántico de `wrap`: devuelve el valor en caché o lo calcula. */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    return this.wrap(key, factory, ttlSeconds);
  }

  /**
   * Invalida todas las claves que empiecen por el prefijo dado.
   * Internamente usa SCAN (nunca KEYS). Devuelve cuántas claves se borraron.
   */
  async invalidateByPrefix(prefix: string): Promise<number> {
    return this.delByPattern(`${prefix}*`);
  }

  async healthCheck(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }
}
