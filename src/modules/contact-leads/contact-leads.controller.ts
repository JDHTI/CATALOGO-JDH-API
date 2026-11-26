import { Body, Controller, Header, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { RateLimit } from '@common/index';

import { CONTACT_LEADS_RATE_LIMIT } from './contact-leads.constants';
import { ContactLeadsService } from './contact-leads.service';
import {
  ContactLeadCreatedDto,
  CreateContactLeadDto,
} from './dto/create-contact-lead.dto';

/**
 * Formulario público de contacto de la home. Sin autenticación: lo llama la
 * Server Action de la UI. Por ahora solo guarda; no hay endpoint de lectura.
 */
@ApiTags('contact-leads')
@Controller('contact-leads')
export class ContactLeadsController {
  constructor(private readonly contactLeads: ContactLeadsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @RateLimit(CONTACT_LEADS_RATE_LIMIT)
  @ApiOperation({
    summary: 'Registra un contacto del formulario de la home',
    description:
      'Si el correo ya existe actualiza sus datos y responde igual (201), ' +
      'para no revelar qué correos están registrados. Cuota propia: 5 ' +
      'envíos cada 10 minutos por IP.',
  })
  @ApiCreatedResponse({ type: ContactLeadCreatedDto })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, falta la autorización de tratamiento de datos, o ' +
      'llega la identificación sin su tipo (o al revés)',
  })
  @ApiTooManyRequestsResponse({ description: 'Se agotó la cuota por IP' })
  create(
    @Body() dto: CreateContactLeadDto,
    @Req() request: Request,
  ): Promise<ContactLeadCreatedDto> {
    // Con TRUST_PROXY configurado, `request.ip` ya es la IP del visitante
    // que la UI reenvía en X-Forwarded-For; si no, es la del servidor de Next.
    return this.contactLeads.upsert(dto, {
      ip: request.ip ?? request.socket?.remoteAddress,
      userAgent: request.get('user-agent'),
    });
  }
}
