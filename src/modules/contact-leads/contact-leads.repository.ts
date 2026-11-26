import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database';
import type { Prisma } from '@prisma-client';

export type ContactLeadData = Omit<
  Prisma.ContactLeadCreateInput,
  'createdAt' | 'updatedAt'
>;

@Injectable()
export class ContactLeadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea el contacto o, si el correo ya existe, reemplaza sus datos.
   * Prisma lo resuelve con `INSERT ... ON CONFLICT (correo)`, así que dos
   * envíos simultáneos del mismo correo no chocan con el índice único.
   */
  async upsertByCorreo(data: ContactLeadData): Promise<{ id: number }> {
    const { correo, ...rest } = data;
    return this.prisma.contactLead.upsert({
      where: { correo },
      create: data,
      update: rest,
      select: { id: true },
    });
  }
}
