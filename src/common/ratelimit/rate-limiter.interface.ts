/** Resultado de consumir un intento contra el limitador. */
export interface RateLimitResult {
  /** `true` si la petición está dentro del límite (o el limitador falló abierto). */
  allowed: boolean;
  /** Máximo de peticiones permitidas en la ventana. */
  limit: number;
  /** Peticiones restantes en la ventana actual (nunca negativo). */
  remaining: number;
  /** Segundos hasta que la ventana actual se reinicia. */
  resetSeconds: number;
}

/**
 * Contrato del limitador de peticiones.
 * La implementación decide el almacenamiento y el algoritmo; los consumidores
 * (guards, middlewares) solo dependen de esta interfaz.
 */
export interface RateLimiter {
  /**
   * Registra un intento para la clave dada (normalmente la IP del cliente)
   * y devuelve el estado del límite tras contabilizarlo.
   */
  consume(key: string): Promise<RateLimitResult>;
}

/** Token de inyección del limitador de peticiones. */
export const RATE_LIMITER = Symbol('RATE_LIMITER');
