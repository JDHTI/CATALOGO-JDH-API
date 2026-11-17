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
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser, JwtAuthGuard, PaginationQueryDto } from '@common/index';
import { EmployeePriceInterceptor } from '@modules/product-prices/employee-price.interceptor';

import { CreateOrderListDto } from './dto/create-order-list.dto';
import {
  OrderListItemResponseDto,
  OrderListItemsResponseDto,
} from './dto/order-list-item-response.dto';
import {
  OrderListResponseDto,
  OrderListsResponseDto,
} from './dto/order-list-response.dto';
import { UpdateOrderListDto } from './dto/update-order-list.dto';
import { UpsertOrderListItemDto } from './dto/upsert-order-list-item.dto';
import { OrderListsService } from './order-lists.service';

/** CRUD de borradores privados de pedido. */
@ApiTags('order-lists')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta el token o no es válido' })
@ApiServiceUnavailableResponse({
  description:
    'El API no tiene AUTH_JWKS_URL configurada o el JWKS no responde',
})
@Controller('order-lists')
@UseGuards(JwtAuthGuard)
export class OrderListsController {
  constructor(private readonly lists: OrderListsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Lista los borradores del usuario autenticado' })
  @ApiOkResponse({ type: OrderListsResponseDto })
  findAll(@CurrentUser() userId: string): Promise<OrderListsResponseDto> {
    return this.lists.findAll(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Crea un borrador de pedido' })
  @ApiCreatedResponse({ type: OrderListResponseDto })
  @ApiConflictResponse({
    description: 'El usuario ya alcanzó el máximo de listas',
  })
  create(
    @CurrentUser() userId: string,
    @Body() input: CreateOrderListDto,
  ): Promise<OrderListResponseDto> {
    return this.lists.create(userId, input);
  }

  @Get(':listId/items')
  @Header('Cache-Control', 'private, no-store')
  // Un empleado JDH recibe `product.precioEmpleado` en cada línea.
  @UseInterceptors(EmployeePriceInterceptor)
  @ApiOperation({
    summary: 'Lista los productos de un borrador',
    description:
      'Incluye el producto completo. Los productos desactivados se conservan ' +
      'con `productActive=false` para que puedan retirarse.',
  })
  @ApiOkResponse({ type: OrderListItemsResponseDto })
  @ApiNotFoundResponse({ description: 'La lista no existe' })
  findItems(
    @CurrentUser() userId: string,
    @Param('listId') listId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<OrderListItemsResponseDto> {
    return this.lists.findItems(userId, listId, query);
  }

  @Put(':listId/items/:productId')
  @ApiOperation({
    summary: 'Agrega o actualiza un producto del borrador',
    description: 'El PUT establece la cantidad final y es idempotente.',
  })
  @ApiOkResponse({ type: OrderListItemResponseDto })
  @ApiNotFoundResponse({ description: 'La lista o el producto no existe' })
  upsertItem(
    @CurrentUser() userId: string,
    @Param('listId') listId: string,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() input: UpsertOrderListItemDto,
  ): Promise<OrderListItemResponseDto> {
    return this.lists.upsertItem(userId, listId, productId, input);
  }

  @Delete(':listId/items/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retira un producto del borrador' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'La lista no existe' })
  async removeItem(
    @CurrentUser() userId: string,
    @Param('listId') listId: string,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<void> {
    await this.lists.removeItem(userId, listId, productId);
  }

  @Get(':listId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Obtiene un borrador del usuario autenticado' })
  @ApiOkResponse({ type: OrderListResponseDto })
  @ApiNotFoundResponse({ description: 'La lista no existe' })
  findOne(
    @CurrentUser() userId: string,
    @Param('listId') listId: string,
  ): Promise<OrderListResponseDto> {
    return this.lists.findOne(userId, listId);
  }

  @Patch(':listId')
  @ApiOperation({ summary: 'Renombra un borrador' })
  @ApiOkResponse({ type: OrderListResponseDto })
  @ApiNotFoundResponse({ description: 'La lista no existe' })
  rename(
    @CurrentUser() userId: string,
    @Param('listId') listId: string,
    @Body() input: UpdateOrderListDto,
  ): Promise<OrderListResponseDto> {
    return this.lists.rename(userId, listId, input);
  }

  @Delete(':listId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina un borrador y sus productos' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'La lista no existe' })
  async remove(
    @CurrentUser() userId: string,
    @Param('listId') listId: string,
  ): Promise<void> {
    await this.lists.remove(userId, listId);
  }
}
