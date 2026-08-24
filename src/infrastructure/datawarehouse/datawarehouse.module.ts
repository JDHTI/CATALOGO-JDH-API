import { Global, Module } from '@nestjs/common';
import { DatawarehouseService } from './datawarehouse.service';

@Global()
@Module({
  providers: [DatawarehouseService],
  exports: [DatawarehouseService],
})
export class DatawarehouseModule {}
