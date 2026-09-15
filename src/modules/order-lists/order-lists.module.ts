import { Module } from '@nestjs/common';

import { AuthModule } from '@common/auth';

import { OrderListsController } from './order-lists.controller';
import { OrderListsRepository } from './order-lists.repository';
import { OrderListsService } from './order-lists.service';

@Module({
  imports: [AuthModule],
  controllers: [OrderListsController],
  providers: [OrderListsService, OrderListsRepository],
})
export class OrderListsModule {}
