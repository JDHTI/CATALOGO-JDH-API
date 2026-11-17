import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '@common/auth';
import { PrismaService } from '@infrastructure/database';
import { MailService } from '@infrastructure/mail';
import { summarizeCart } from '@modules/product-prices/cart-summary';
import { EMPLOYEE_PRICE_LIST } from '@modules/product-prices/price-list.file';
import {
  ProductPricesService,
  type EmployeePrice,
} from '@modules/product-prices/product-prices.service';
import { toProductResponse } from '@modules/products/product.mapper';
import {
  PUBLIC_PRODUCT_INCLUDE,
  type ProductWithRelations,
} from '@modules/products/products.repository';
import { Prisma } from '@prisma-client';

import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  orderNumber,
} from './cart.constants';
import type {
  AddListResponseDto,
  CartLineDto,
  CartResponseDto,
  CheckoutLineDto,
  CheckoutPreviewDto,
  OmittedLineDto,
  OrderResponseDto,
} from './dto/cart.dto';
import { renderOrderEmail } from './order-email.template';

const LIST = EMPLOYEE_PRICE_LIST;

type CartRow = {
  productId: number;
  quantity: number;
  addedPrice: Prisma.Decimal | null;
  addedVatPct: Prisma.Decimal | null;
  product: ProductWithRelations;
};

const ORDER_INCLUDE = { items: { orderBy: { name: 'asc' } } } as const;
type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * Carrito y pedidos de empleados JDH.
 *
 * - El carrito NO guarda precios para cobrar: cada lectura usa la lista
 *   vigente. La línea recuerda el precio con que se agregó solo para marcar
 *   `precioCambio`.
 * - El carrito no muestra IVA; el IVA aparece en la vista previa del envío y
 *   en el pedido, como un solo valor (`impuestos`), calculado por línea.
 * - El pedido congela todo (sku, nombre, precio, IVA, totales) y, tras
 *   registrarse, se envía el consolidado por correo. Un fallo del correo no
 *   deshace el pedido: queda con el correo en `error` para reenviarlo.
 */
@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: ProductPricesService,
    private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------- carrito

  async getCart(userId: string): Promise<CartResponseDto> {
    const rows = await this.cartRows(userId);
    const priceMap = await this.priceMap(rows.map((row) => row.productId));
    const items = rows.map((row) =>
      toCartLine(row, priceMap.get(row.productId)),
    );
    const available = items.filter((item) => item.disponible);

    return {
      items,
      resumen: {
        lineas: items.length,
        unidades: items.reduce((sum, item) => sum + item.cantidad, 0),
        subtotal: available.reduce((sum, item) => sum + item.totalLinea!, 0),
        lineasNoDisponibles: items.length - available.length,
      },
    };
  }

  /** Fija la cantidad de una línea (la crea si no existe). Idempotente. */
  async setQuantity(
    userId: string,
    productId: number,
    quantity: number,
  ): Promise<CartResponseDto> {
    const price = await this.requirePurchasable(productId);
    const cartId = await this.cartId(userId);
    await this.ensureRoomFor(cartId, [productId]);
    await this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId, productId } },
      create: { cartId, productId, quantity, ...snapshotOf(price) },
      update: { quantity, ...snapshotOf(price) },
    });
    return this.getCart(userId);
  }

  /** Suma unidades a una línea (botón «agregar al carrito»). */
  async addQuantity(
    userId: string,
    productId: number,
    quantity: number,
  ): Promise<CartResponseDto> {
    const cartId = await this.cartId(userId);
    const current = await this.prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId, productId } },
      select: { quantity: true },
    });
    const total = (current?.quantity ?? 0) + quantity;
    if (total > MAX_LINE_QUANTITY) {
      throw new BadRequestException(
        `Máximo ${MAX_LINE_QUANTITY} unidades por producto`,
      );
    }
    return this.setQuantity(userId, productId, total);
  }

  async removeItem(
    userId: string,
    productId: number,
  ): Promise<CartResponseDto> {
    await this.prisma.cartItem.deleteMany({
      where: { productId, cart: { userId } },
    });
    return this.getCart(userId);
  }

  async clear(userId: string): Promise<CartResponseDto> {
    await this.prisma.cartItem.deleteMany({ where: { cart: { userId } } });
    return this.getCart(userId);
  }

  /**
   * Lleva una lista de pedido completa al carrito. Lo que no se puede comprar
   * (producto inactivo o sin precio de empleado, o el tope de líneas) se
   * informa en `omitidos` en vez de fallar la operación entera.
   */
  async addList(
    userId: string,
    listId: string,
    mode: 'sumar' | 'reemplazar' = 'sumar',
  ): Promise<AddListResponseDto> {
    const list = await this.prisma.orderList.findFirst({
      where: { id: listId, userId },
      select: {
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            productId: true,
            quantity: true,
            product: { select: { name: true, active: true } },
          },
        },
      },
    });
    if (!list) throw new NotFoundException('Lista no encontrada');

    const priceMap = await this.priceMap(list.items.map((i) => i.productId));
    const cartId = await this.cartId(userId);
    const omitidos: OmittedLineDto[] = [];
    let agregados = 0;

    await this.prisma.$transaction(async (tx) => {
      if (mode === 'reemplazar') {
        await tx.cartItem.deleteMany({ where: { cartId } });
      }
      const existing = new Map(
        (
          await tx.cartItem.findMany({
            where: { cartId },
            select: { productId: true, quantity: true },
          })
        ).map((row) => [row.productId, row.quantity]),
      );

      for (const item of list.items) {
        const price = priceMap.get(item.productId);
        const nombre = item.product.name;
        if (!item.product.active) {
          omitidos.push({
            productId: item.productId,
            nombre,
            motivo: 'inactivo',
          });
          continue;
        }
        if (!price) {
          omitidos.push({
            productId: item.productId,
            nombre,
            motivo: 'sin_precio',
          });
          continue;
        }
        const before = existing.get(item.productId);
        if (before === undefined && existing.size >= MAX_CART_LINES) {
          omitidos.push({
            productId: item.productId,
            nombre,
            motivo: 'limite',
          });
          continue;
        }
        const quantity = Math.min(
          MAX_LINE_QUANTITY,
          (before ?? 0) + item.quantity,
        );
        await tx.cartItem.upsert({
          where: { cartId_productId: { cartId, productId: item.productId } },
          create: {
            cartId,
            productId: item.productId,
            quantity,
            ...snapshotOf(price),
          },
          update: { quantity, ...snapshotOf(price) },
        });
        existing.set(item.productId, quantity);
        agregados++;
      }
      await tx.cart.update({
        where: { id: cartId },
        data: { updatedAt: new Date() },
      });
    });

    return { carrito: await this.getCart(userId), agregados, omitidos };
  }

  // ---------------------------------------------------------------- pedido

  /** Pantalla de enviar pedido: subtotal, impuestos y total, sin desglose. */
  async preview(user: AuthenticatedUser): Promise<CheckoutPreviewDto> {
    const customer = requireCustomer(user);
    const rows = await this.cartRows(user.sub);
    return buildPreview(
      rows,
      await this.priceMap(rows.map((r) => r.productId)),
      customer,
    );
  }

  /**
   * Registra el pedido con los precios vigentes, vacía el carrito y envía el
   * consolidado por correo. El carrito se bloquea (`FOR UPDATE`) durante la
   * transacción: un doble clic no crea dos pedidos, el segundo encuentra el
   * carrito vacío (409).
   */
  async checkout(
    user: AuthenticatedUser,
    input: { nota?: string; totalEsperado?: number },
  ): Promise<OrderResponseDto> {
    const customer = requireCustomer(user);
    const cartId = await this.cartId(user.sub);

    const order = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM carts WHERE id = ${cartId} FOR UPDATE`;
        const rows = await this.cartRows(user.sub, tx);
        if (rows.length === 0) {
          throw new ConflictException({
            message: 'El carrito está vacío',
            code: 'CARRITO_VACIO',
          });
        }
        const priceMap = await this.priceMap(rows.map((row) => row.productId));
        const preview = buildPreview(rows, priceMap, customer);

        if (preview.noDisponibles.length > 0) {
          throw new ConflictException({
            message:
              'Hay productos que ya no están disponibles; quítalos del carrito',
            code: 'NO_DISPONIBLES',
            noDisponibles: preview.noDisponibles,
          });
        }
        if (
          input.totalEsperado !== undefined &&
          input.totalEsperado !== preview.total
        ) {
          throw new ConflictException({
            message:
              'Los precios cambiaron; revisa el pedido antes de enviarlo',
            code: 'PRECIOS_CAMBIARON',
            resumen: preview,
          });
        }

        const summary = summarizeCart(
          rows.map((row) => {
            const price = priceMap.get(row.productId)!;
            return {
              productoId: row.productId,
              cantidad: row.quantity,
              precio: {
                lista: LIST,
                precio: price.precio,
                ivaPct: price.ivaPct,
                fechaFoto: price.fechaFoto,
              },
            };
          }),
        );
        const byProduct = new Map(summary.lineas.map((l) => [l.productoId, l]));

        const created = await tx.order.create({
          data: {
            userId: user.sub,
            customerName: customer.nombre,
            customerEmail: customer.email,
            note: input.nota?.trim() || null,
            priceList: LIST,
            snapshotDate: new Date(`${preview.fechaFoto}T00:00:00Z`),
            subtotal: summary.subtotal,
            taxes: summary.iva,
            total: summary.total,
            hasUnconfirmedVat: summary.ivaPorConfirmar !== null,
            items: {
              create: rows.map((row) => {
                const line = byProduct.get(row.productId)!;
                return {
                  productId: row.productId,
                  sku: row.product.sku,
                  name: row.product.name,
                  quantity: row.quantity,
                  unitPrice: priceMap.get(row.productId)!.precio,
                  vatPct: line.ivaPct,
                  base: line.base,
                  vat: line.iva,
                };
              }),
            },
          },
          include: ORDER_INCLUDE,
        });
        await tx.cartItem.deleteMany({ where: { cartId } });
        return created;
      },
      { timeout: 30_000 },
    );

    return toOrderResponse(await this.sendOrderEmail(order));
  }

  async listOrders(userId: string): Promise<OrderResponseDto[]> {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return orders.map(toOrderResponse);
  }

  async getOrder(userId: string, orderId: string): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return toOrderResponse(order);
  }

  /** Reenvía el correo de un pedido (CLI de operación). */
  async resendOrderEmail(number: number): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { number },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException(`Pedido ${number} no encontrado`);
    return toOrderResponse(await this.sendOrderEmail(order));
  }

  // ---------------------------------------------------------------- interno

  private async sendOrderEmail(order: OrderWithItems): Promise<OrderWithItems> {
    const { orderTo, orderCcCustomer } = this.mail.settings;
    // Sin buzón interno configurado, el consolidado le llega al empleado (a
    // la espera de que se defina el buzón de pedidos).
    const to = orderTo.length > 0 ? orderTo : [order.customerEmail];
    const cc =
      orderTo.length > 0 && orderCcCustomer ? [order.customerEmail] : [];

    const { subject, html } = renderOrderEmail(toOrderResponse(order));
    const result = await this.mail.send({ to, cc, subject, html });
    if (result.status === 'error') {
      this.logger.warn(
        `Correo del pedido ${orderNumber(order.number)}: ${result.error}`,
      );
    }

    return this.prisma.order.update({
      where: { id: order.id },
      data: {
        emailStatus: result.status,
        emailError:
          result.status === 'error'
            ? result.error
            : result.status === 'deshabilitado'
              ? result.reason
              : null,
        emailSentAt:
          result.status === 'enviado' ? new Date() : order.emailSentAt,
      },
      include: ORDER_INCLUDE,
    });
  }

  private async cartId(userId: string): Promise<string> {
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });
    return cart.id;
  }

  private async cartRows(
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<CartRow[]> {
    return client.cartItem.findMany({
      where: { cart: { userId } },
      orderBy: { createdAt: 'asc' },
      select: {
        productId: true,
        quantity: true,
        addedPrice: true,
        addedVatPct: true,
        product: { include: PUBLIC_PRODUCT_INCLUDE },
      },
    });
  }

  private priceMap(productIds: number[]): Promise<Map<number, EmployeePrice>> {
    return this.prices.findForProducts(LIST, productIds);
  }

  /** 404 si no existe o está inactivo; 422 si no tiene precio de empleado. */
  private async requirePurchasable(productId: number): Promise<EmployeePrice> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, active: true },
      select: { id: true },
    });
    if (!product)
      throw new NotFoundException(`Producto ${productId} no encontrado`);

    const price = (await this.priceMap([productId])).get(productId);
    if (!price) {
      throw new UnprocessableEntityException(
        'Este producto no tiene precio de empleado y no se puede pedir',
      );
    }
    return price;
  }

  private async ensureRoomFor(
    cartId: string,
    productIds: number[],
  ): Promise<void> {
    const [count, present] = await Promise.all([
      this.prisma.cartItem.count({ where: { cartId } }),
      this.prisma.cartItem.count({
        where: { cartId, productId: { in: productIds } },
      }),
    ]);
    if (count - present + productIds.length > MAX_CART_LINES) {
      throw new ConflictException({
        message: `El carrito admite máximo ${MAX_CART_LINES} productos distintos`,
        code: 'LIMITE_LINEAS',
      });
    }
  }
}

function snapshotOf(price: EmployeePrice) {
  return { addedPrice: price.precio, addedVatPct: price.ivaPct };
}

function toCartLine(
  row: CartRow,
  price: EmployeePrice | undefined,
): CartLineDto {
  const disponible = row.product.active && price !== undefined;
  const precioCambio =
    price !== undefined &&
    row.addedPrice !== null &&
    (!row.addedPrice.equals(price.precio) ||
      (row.addedVatPct === null
        ? price.ivaPct !== null
        : price.ivaPct === null || !row.addedVatPct.equals(price.ivaPct)));

  return {
    productId: row.productId,
    cantidad: row.quantity,
    producto: {
      ...toProductResponse(row.product),
      precioEmpleado: price ?? null,
    },
    disponible,
    precioUnitario: disponible ? price.precio : null,
    totalLinea: disponible ? price.precio * row.quantity : null,
    precioCambio,
  };
}

function requireCustomer(user: AuthenticatedUser): {
  nombre: string;
  email: string;
} {
  if (!user.name || !user.email) {
    throw new UnprocessableEntityException(
      'La sesión no trae nombre y correo del empleado; vuelve a iniciar sesión',
    );
  }
  return { nombre: user.name, email: user.email };
}

function buildPreview(
  rows: CartRow[],
  priceMap: Map<number, EmployeePrice>,
  solicitante: { nombre: string; email: string },
): CheckoutPreviewDto {
  const available = rows.filter(
    (row) => row.product.active && priceMap.has(row.productId),
  );
  const summary = summarizeCart(
    available.map((row) => {
      const price = priceMap.get(row.productId)!;
      return {
        productoId: row.productId,
        cantidad: row.quantity,
        precio: {
          lista: LIST,
          precio: price.precio,
          ivaPct: price.ivaPct,
          fechaFoto: price.fechaFoto,
        },
      };
    }),
  );
  const fechas = available.map((row) => priceMap.get(row.productId)!.fechaFoto);

  return {
    lineas: available.map((row): CheckoutLineDto => {
      const precio = priceMap.get(row.productId)!.precio;
      return {
        productId: row.productId,
        sku: row.product.sku,
        nombre: row.product.name,
        cantidad: row.quantity,
        precioUnitario: precio,
        totalLinea: precio * row.quantity,
      };
    }),
    subtotal: summary.subtotal,
    impuestos: summary.iva,
    total: summary.total,
    ivaPorConfirmar: summary.ivaPorConfirmar !== null,
    fechaFoto: fechas.length > 0 ? fechas.sort().at(-1)! : null,
    solicitante,
    noDisponibles: rows
      .filter((row) => !available.includes(row))
      .map((row) => row.productId),
  };
}

export function toOrderResponse(order: OrderWithItems): OrderResponseDto {
  return {
    id: order.id,
    numero: orderNumber(order.number),
    fecha: order.createdAt.toISOString(),
    solicitante: { nombre: order.customerName, email: order.customerEmail },
    nota: order.note,
    lineas: order.items.map((item) => ({
      productId: item.productId,
      sku: item.sku,
      nombre: item.name,
      cantidad: item.quantity,
      precioUnitario: Number(item.unitPrice),
      totalLinea: Number(item.base),
    })),
    subtotal: Number(order.subtotal),
    impuestos: Number(order.taxes),
    total: Number(order.total),
    ivaPorConfirmar: order.hasUnconfirmedVat,
    fechaFoto: order.snapshotDate.toISOString().slice(0, 10),
    correo: order.emailStatus as OrderResponseDto['correo'],
  };
}
