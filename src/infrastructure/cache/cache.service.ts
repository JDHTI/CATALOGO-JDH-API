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
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private generation = 0;
  private lastWarningAt = 0;

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
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      enableAutoPipelining: true,
      connectTimeout: redis.connectTimeout,
      commandTimeout: redis.commandTimeout,
      enableReadyCheck: true,
    });

    this.client.on('error', (error) =>
      this.warn(`Error de Redis: ${error.message}`),
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
    if (this.client.status !== 'ready') return null;
    try {
      const value = await this.client.get(key);
      return value === null ? null : (JSON.parse(value) as T);
    } catch (error) {
      this.warn(`Fallo al leer caché: ${(error as Error).message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (this.client.status !== 'ready' || value === null || value === undefined)
      return;
    const ttl = ttlSeconds ?? this.defaultTtl;
    if (ttl <= 0) return;
    try {
      await this.client.set(
        key,
        JSON.stringify(value),
        'EX',
        Math.max(1, Math.floor(ttl * (0.9 + Math.random() * 0.1))),
      );
    } catch (error) {
      this.warn(`Fallo al escribir caché: ${(error as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    this.generation++;
    keys.forEach((key) => this.inFlight.delete(key));
    try {
      await this.client.del(...keys);
    } catch (error) {
      this.logger.warn(`Fallo al borrar claves: ${(error as Error).message}`);
    }
  }

  /** Borra por patrón usando SCAN (nunca KEYS, que bloquea el servidor). */
  async delByPattern(pattern: string): Promise<number> {
    this.generation++;
    this.inFlight.clear();
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
          await this.client.unlink(
            ...keys.map((key) => key.slice(prefix.length)),
          );
          deleted += keys.length;
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(
        `Fallo al invalidar el patrón "${pattern}": ${(error as Error).message}`,
      );
    }

    this.generation++;
    this.inFlight.clear();
    return deleted;
  }

  /** Devuelve el valor en caché o lo calcula y lo almacena. */
  wrap<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const generation = this.generation;
    const pending = (async () => {
      const cached = await this.get<T>(key);
      if (cached !== null) return cached;
      const value = await factory();
      if (generation === this.generation)
        await this.set(key, value, ttlSeconds);
      return value;
    })();
    this.inFlight.set(key, pending);
    const cleanup = () => {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    };
    void pending.then(cleanup, cleanup);
    return pending;
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
    if (this.client.status !== 'ready') return false;
    return (await this.client.ping()) === 'PONG';
  }

  private warn(message: string): void {
    if (Date.now() - this.lastWarningAt < 30000) return;
    this.lastWarningAt = Date.now();
    this.logger.warn(message);
  }
}
