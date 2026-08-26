import { Injectable } from '@nestjs/common';

import { SupplierResponseDto } from './dto/supplier-response.dto';
import { SuppliersRepository } from './suppliers.repository';

@Injectable()
export class SuppliersService {
  constructor(private readonly suppliers: SuppliersRepository) {}

  /** Lista completa (sin paginación) de proveedores con productos activos. */
  async findAll(): Promise<SupplierResponseDto[]> {
    const suppliers = await this.suppliers.findAllWithActiveProducts();

    return suppliers.map((supplier) => ({
      id: supplier.id,
      nombre: supplier.name,
      totalProductos: supplier.activeProducts,
      logoUrl: supplier.logoUrl,
    }));
  }
}
