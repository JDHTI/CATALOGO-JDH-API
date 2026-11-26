import { Injectable } from '@nestjs/common';

import {
  MAX_IP_LENGTH,
  MAX_USER_AGENT_LENGTH,
} from './contact-leads.constants';
import { ContactLeadsRepository } from './contact-leads.repository';
import type {
  ContactLeadCreatedDto,
  CreateContactLeadDto,
} from './dto/create-contact-lead.dto';

/** Origen de la petición, para la evidencia de la autorización. */
export interface ContactLeadRequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class ContactLeadsService {
  constructor(private readonly repository: ContactLeadsRepository) {}

  /**
   * Guarda el contacto. Si el correo ya estaba, actualiza sus datos y la
   * fecha de la autorización; la respuesta es la misma en ambos casos.
   */
  async upsert(
    dto: CreateContactLeadDto,
    meta: ContactLeadRequestMeta,
  ): Promise<ContactLeadCreatedDto> {
    return this.repository.upsertByCorreo({
      nombre: dto.nombre,
      correo: dto.correo,
      celular: dto.celular,
      ciudad: dto.ciudad,
      tipoIdentificacion: dto.tipoIdentificacion ?? null,
      identificacion: dto.identificacion ?? null,
      origen: dto.origen,
      aceptaTratamientoAt: new Date(),
      ip: meta.ip?.slice(0, MAX_IP_LENGTH) || null,
      userAgent: meta.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) || null,
    });
  }
}
