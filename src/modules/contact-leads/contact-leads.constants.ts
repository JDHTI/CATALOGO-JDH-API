export const CONTACT_LEAD_ID_TYPES = ['NIT', 'CC'] as const;
export type ContactLeadIdType = (typeof CONTACT_LEAD_ID_TYPES)[number];

/**
 * Cuota propia del formulario público, por IP: 5 envíos cada 10 minutos.
 * La global (`RATE_LIMIT_*`) sigue aplicando encima.
 */
export const CONTACT_LEADS_RATE_LIMIT = {
  name: 'contact-leads',
  max: 5,
  ttl: 600,
};

/** Largo de las columnas `ip` y `user_agent`. */
export const MAX_IP_LENGTH = 45;
export const MAX_USER_AGENT_LENGTH = 512;
