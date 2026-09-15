import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Nuevo nombre de una lista existente. */
export class UpdateOrderListDto {
  @ApiProperty({
    example: 'Pedido de cafetería - septiembre',
    minLength: 1,
    maxLength: 100,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}
