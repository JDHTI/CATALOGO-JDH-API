import { Module } from '@nestjs/common';

import { ContactLeadsController } from './contact-leads.controller';
import { ContactLeadsRepository } from './contact-leads.repository';
import { ContactLeadsService } from './contact-leads.service';

@Module({
  controllers: [ContactLeadsController],
  providers: [ContactLeadsService, ContactLeadsRepository],
})
export class ContactLeadsModule {}
