import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ProductResponseDto } from '@modules/products/dto/product-response.dto';

import { MAX_LINE_QUANTITY } from '../cart.constants';

/** Cantidad de una línea: `PUT` la fija, `POST` la suma. */
export class CartQuantityDto {
  @ApiProperty({ minimum: 1, maximum: MAX_LINE_QUANTITY, example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity!: number;
}

export class AddListToCartDto {
  @ApiPropertyOptional({
    enum: ['sumar', 'reemplazar'],
    default: 'sumar',
    description:
      '`sumar` agrega las cantidades de la lista a lo que ya hay en el ' +
      'carrito; `reemplazar` vacía el carrito antes.',
  })
  @IsOptional()
  @IsIn(['sumar', 'reemplazar'])
  mode?: 'sumar' | 'reemplazar';
}

export class CheckoutDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Observaciones del empleado para quien despacha',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;

  @ApiPropertyOptional({
    example: 229797,
    description:
      'Total que el empleado vio en la pantalla de enviar pedido. Si la ' +
      'lista cambió desde entonces, el API responde 409 con el resumen nuevo ' +
      'en vez de registrar un total distinto al que aceptó.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalEsperado?: number;
}

export class CartLineDto {
  @ApiProperty({ example: 42 })
  productId!: number;

  @ApiProperty({ example: 2 })
  cantidad!: number;

  @ApiProperty({
    type: ProductResponseDto,
    description: 'Producto completo, con `precioEmpleado`',
  })
  producto!: ProductResponseDto;

  @ApiProperty({
    description:
      'false si el producto se desactivó o salió de la lista de precios: ' +
      'no suma al subtotal y bloquea el envío hasta quitarlo.',
  })
  disponible!: boolean;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Precio unitario sin IVA vigente',
  })
  precioUnitario!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'precioUnitario × cantidad, sin IVA',
  })
  totalLinea!: number | null;

  @ApiProperty({
    description:
      'El precio o el IVA cambiaron desde que se agregó la línea (la lista ' +
      'se recargó). El total ya usa el precio nuevo; la UI debería avisar.',
  })
  precioCambio!: boolean;
}

export class CartSummaryDto {
  @ApiProperty({ example: 3 })
  lineas!: number;

  @ApiProperty({ example: 7 })
  unidades!: number;

  @ApiProperty({
    example: 199275,
    description: 'Σ totalLinea de las líneas disponibles, SIN IVA',
  })
  subtotal!: number;

  @ApiProperty({ example: 0 })
  lineasNoDisponibles!: number;
}

export class CartResponseDto {
  @ApiProperty({ type: [CartLineDto] })
  items!: CartLineDto[];

  @ApiProperty({ type: CartSummaryDto })
  resumen!: CartSummaryDto;
}

export class OmittedLineDto {
  @ApiProperty() productId!: number;
  @ApiProperty() nombre!: string;
  @ApiProperty({ enum: ['inactivo', 'sin_precio', 'limite'] })
  motivo!: 'inactivo' | 'sin_precio' | 'limite';
}

export class AddListResponseDto {
  @ApiProperty({ type: CartResponseDto }) carrito!: CartResponseDto;
  @ApiProperty({ description: 'Líneas de la lista llevadas al carrito' })
  agregados!: number;
  @ApiProperty({ type: [OmittedLineDto] }) omitidos!: OmittedLineDto[];
}

export class CheckoutLineDto {
  @ApiProperty() productId!: number;
  @ApiProperty() sku!: string;
  @ApiProperty() nombre!: string;
  @ApiProperty() cantidad!: number;
  @ApiProperty({ description: 'Sin IVA' }) precioUnitario!: number;
  @ApiProperty({ description: 'Sin IVA' }) totalLinea!: number;
}

export class CustomerDto {
  @ApiProperty({ example: 'Ana María Pérez' }) nombre!: string;
  @ApiProperty({ example: 'ana.perez@jdh.com.co' }) email!: string;
}

export class CheckoutPreviewDto {
  @ApiProperty({ type: [CheckoutLineDto] }) lineas!: CheckoutLineDto[];
  @ApiProperty({ description: 'Σ bases sin IVA' }) subtotal!: number;
  @ApiProperty({
    description:
      'IVA total, sin desglose por tarifa (calculado por línea y redondeado ' +
      'como una factura)',
  })
  impuestos!: number;
  @ApiProperty() total!: number;
  @ApiProperty({
    description:
      'Hay productos con IVA por confirmar: su IVA no está en `impuestos`',
  })
  ivaPorConfirmar!: boolean;
  @ApiProperty({ example: '2026-11-17', nullable: true, type: String })
  fechaFoto!: string | null;
  @ApiProperty({ type: CustomerDto }) solicitante!: CustomerDto;
  @ApiProperty({
    type: [Number],
    description: 'productIds no disponibles: bloquean el envío',
  })
  noDisponibles!: number[];
}

export class OrderResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PED-000123' }) numero!: string;
  @ApiProperty({ format: 'date-time' }) fecha!: string;
  @ApiProperty({ type: CustomerDto }) solicitante!: CustomerDto;
  @ApiProperty({ nullable: true, type: String }) nota!: string | null;
  @ApiProperty({ type: [CheckoutLineDto] }) lineas!: CheckoutLineDto[];
  @ApiProperty() subtotal!: number;
  @ApiProperty() impuestos!: number;
  @ApiProperty() total!: number;
  @ApiProperty() ivaPorConfirmar!: boolean;
  @ApiProperty({ example: '2026-11-17' }) fechaFoto!: string;
  @ApiProperty({
    enum: ['pendiente', 'enviado', 'error', 'deshabilitado'],
    description: 'Estado del correo con el consolidado',
  })
  correo!: 'pendiente' | 'enviado' | 'error' | 'deshabilitado';
}
