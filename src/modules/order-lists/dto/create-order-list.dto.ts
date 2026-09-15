import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Nombre de una lista nueva. Se normalizan los espacios en los extremos. */
export class CreateOrderListDto {
  @ApiProperty({ example: 'Pedido de cafetería', minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}
