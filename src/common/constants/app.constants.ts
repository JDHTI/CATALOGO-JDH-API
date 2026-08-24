export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 25,
  MAX_LIMIT: 100,
} as const;

/** Prefijos de claves de caché, para poder invalidar por patrón. */
export const CACHE_KEYS = {
  CATALOG_ITEM: (id: string) => `catalog:item:${id}`,
  CATALOG_LIST: (hash: string) => `catalog:list:${hash}`,
  CATALOG_PATTERN: 'catalog:*',
} as const;
