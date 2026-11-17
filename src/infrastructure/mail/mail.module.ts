import { Global, Module } from '@nestjs/common';

import { MailService } from './mail.service';

/** Correo saliente (Microsoft Graph). Global, como el resto de infraestructura. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
