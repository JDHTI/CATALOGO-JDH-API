import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateOrderListDto } from './create-order-list.dto';
import { UpdateOrderListDto } from './update-order-list.dto';
import { UpsertOrderListItemDto } from './upsert-order-list-item.dto';

describe('order-list DTOs', () => {
  it('recorta espacios del nombre y valida el límite de 100 caracteres', () => {
    const dto = plainToInstance(CreateOrderListDto, { name: '  Cafetería  ' });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.name).toBe('Cafetería');
    expect(
      validateSync(
        plainToInstance(CreateOrderListDto, { name: 'x'.repeat(101) }),
      ),
    ).not.toHaveLength(0);
  });

  it('aplica las mismas reglas al renombrar', () => {
    const dto = plainToInstance(UpdateOrderListDto, {
      name: '  Nuevo nombre ',
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.name).toBe('Nuevo nombre');
  });

  it('convierte quantity a entero positivo', () => {
    const dto = plainToInstance(UpsertOrderListItemDto, { quantity: '3' });

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.quantity).toBe(3);
    expect(
      validateSync(plainToInstance(UpsertOrderListItemDto, { quantity: '0' })),
    ).not.toHaveLength(0);
  });
});
