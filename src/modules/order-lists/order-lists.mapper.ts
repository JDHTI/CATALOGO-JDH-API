import type { OrderListItemResponseDto } from './dto/order-list-item-response.dto';
import type { OrderListResponseDto } from './dto/order-list-response.dto';
import type {
  OrderListItemWithProduct,
  OrderListWithCount,
} from './order-lists.repository';
import { toProductResponse } from '@modules/products/product.mapper';

export function toOrderListResponse(
  list: OrderListWithCount,
): OrderListResponseDto {
  return {
    id: list.id,
    name: list.name,
    itemCount: list._count.items,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  };
}

export function toOrderListItemResponse(
  item: OrderListItemWithProduct,
): OrderListItemResponseDto {
  return {
    productId: item.productId,
    quantity: item.quantity,
    productActive: item.product.active,
    product: toProductResponse(item.product),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
