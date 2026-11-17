import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import {
  CurrentIdentity,
  CurrentUser,
  EmployeeGuard,
  JwtAuthGuard,
  type AuthenticatedUser,
} from '@common/index';

import { CartService } from './cart.service';
import {
  AddListResponseDto,
  AddListToCartDto,
  CartQuantityDto,
  CartResponseDto,
  CheckoutDto,
  CheckoutPreviewDto,
  OrderResponseDto,
} from './dto/cart.dto';

/**
 * Carrito de compras de empleados JDH. Un carrito por usuario; los precios
 * salen de la lista de empleados vigente en cada lectura. Sin IVA: el IVA
 * aparece solo en `GET /cart/checkout` y en el pedido.
 *
 * Todas las respuestas son personales: `private, no-store` y sin caché Redis.
 */
@ApiTags('cart')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta el token o no es válido' })
@ApiForbiddenResponse({ description: 'La sesión no es de un empleado JDH' })
@Controller('cart')
@UseGuards(JwtAuthGuard, EmployeeGuard)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Carrito del empleado, con subtotal sin IVA' })
  @ApiOkResponse({ type: CartResponseDto })
  get(@CurrentUser() userId: string): Promise<CartResponseDto> {
    return this.cart.getCart(userId);
  }

  @Post('items/:productId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Agrega unidades de un producto (suma a lo que ya haya)',
  })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiNotFoundResponse({ description: 'El producto no existe o está inactivo' })
  @ApiUnprocessableEntityResponse({
    description: 'El producto no tiene precio de empleado',
  })
  add(
    @CurrentUser() userId: string,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() input: CartQuantityDto,
  ): Promise<CartResponseDto> {
    return this.cart.addQuantity(userId, productId, input.quantity);
  }

  @Put('items/:productId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Fija la cantidad de un producto (idempotente)' })
  @ApiOkResponse({ type: CartResponseDto })
  @ApiNotFoundResponse({ description: 'El producto no existe o está inactivo' })
  @ApiUnprocessableEntityResponse({
    description: 'El producto no tiene precio de empleado',
  })
  set(
    @CurrentUser() userId: string,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() input: CartQuantityDto,
  ): Promise<CartResponseDto> {
    return this.cart.setQuantity(userId, productId, input.quantity);
  }

  @Delete('items/:productId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Quita un producto del carrito (idempotente)' })
  @ApiOkResponse({ type: CartResponseDto })
  remove(
    @CurrentUser() userId: string,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<CartResponseDto> {
    return this.cart.removeItem(userId, productId);
  }

  @Delete()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Vacía el carrito' })
  @ApiOkResponse({ type: CartResponseDto })
  clear(@CurrentUser() userId: string): Promise<CartResponseDto> {
    return this.cart.clear(userId);
  }

  @Post('from-list/:listId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Lleva una lista de pedido al carrito («comprar esta lista»)',
    description:
      'Lo que no se puede comprar (inactivo, sin precio o tope de líneas) ' +
      'vuelve en `omitidos`; el resto entra al carrito.',
  })
  @ApiOkResponse({ type: AddListResponseDto })
  @ApiNotFoundResponse({ description: 'La lista no existe' })
  addList(
    @CurrentUser() userId: string,
    @Param('listId') listId: string,
    @Body() input: AddListToCartDto,
  ): Promise<AddListResponseDto> {
    return this.cart.addList(userId, listId, input.mode);
  }

  @Get('checkout')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Pantalla de enviar pedido: subtotal, impuestos y total',
    description:
      'Impuestos sin desglose por tarifa. Incluye el nombre y el correo del ' +
      'empleado tal como vienen de Entra.',
  })
  @ApiOkResponse({ type: CheckoutPreviewDto })
  preview(
    @CurrentIdentity() user: AuthenticatedUser,
  ): Promise<CheckoutPreviewDto> {
    return this.cart.preview(user);
  }

  @Post('checkout')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Envía el pedido',
    description:
      'Registra el pedido con los precios vigentes, vacía el carrito y envía ' +
      'el consolidado por correo. `correo` en la respuesta dice si salió.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({
    description:
      'Carrito vacío, productos no disponibles o el total cambió respecto a `totalEsperado`',
  })
  checkout(
    @CurrentIdentity() user: AuthenticatedUser,
    @Body() input: CheckoutDto,
  ): Promise<OrderResponseDto> {
    return this.cart.checkout(user, input);
  }
}

/** Pedidos enviados por el empleado (confirmación e historial). */
@ApiTags('orders')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta el token o no es válido' })
@ApiForbiddenResponse({ description: 'La sesión no es de un empleado JDH' })
@Controller('orders')
@UseGuards(JwtAuthGuard, EmployeeGuard)
export class OrdersController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Últimos 50 pedidos del empleado' })
  @ApiOkResponse({ type: [OrderResponseDto] })
  list(@CurrentUser() userId: string): Promise<OrderResponseDto[]> {
    return this.cart.listOrders(userId);
  }

  @Get(':orderId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Un pedido del empleado' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiNotFoundResponse({ description: 'No existe o es de otro usuario' })
  get(
    @CurrentUser() userId: string,
    @Param('orderId') orderId: string,
  ): Promise<OrderResponseDto> {
    return this.cart.getOrder(userId, orderId);
  }
}
