/**
 * Reenvía el correo con el consolidado de un pedido (p. ej. tras configurar
 * las credenciales o corregir el buzón):
 *
 *   pnpm orders:resend-email <número>      # 123 o PED-000123
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { CartService } from './cart.service';

async function main(): Promise<void> {
  const raw = process.argv[2] ?? '';
  const number = Number(raw.replace(/^PED-/i, ''));
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error('Uso: pnpm orders:resend-email <número de pedido>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const order = await app.get(CartService).resendOrderEmail(number);
    console.log(`${order.numero}: correo ${order.correo}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  new Logger('ResendOrderEmailCli').error((error as Error).message);
  process.exitCode = 1;
});
