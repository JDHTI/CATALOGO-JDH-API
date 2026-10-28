import { NotFoundException } from '@nestjs/common';

import type {
  CategoriesRepository,
  CategoryNode,
} from './categories.repository';
import { CategoriesService } from './categories.service';

const alimentos: CategoryNode = {
  id: 1,
  slug: 'alimentos',
  name: 'Alimentos',
  total: 30,
  subcategories: [
    { id: 5, slug: 'aceites-y-grasas', name: 'Aceites y grasas', total: 12 },
    { id: 6, slug: 'bebidas', name: 'Bebidas', total: 18 },
  ],
};

const build = (tree: CategoryNode[] = [alimentos]) => {
  const findTree = jest.fn().mockResolvedValue(tree);
  const service = new CategoriesService({
    findTree,
  } as unknown as CategoriesRepository);
  return { service, findTree };
};

describe('CategoriesService', () => {
  describe('findAll', () => {
    it('mapea el árbol al contrato público', async () => {
      const { service } = build();

      await expect(service.findAll({})).resolves.toEqual([
        {
          id: 1,
          slug: 'alimentos',
          nombre: 'Alimentos',
          totalProductos: 30,
          subcategorias: [
            {
              id: 5,
              slug: 'aceites-y-grasas',
              nombre: 'Aceites y grasas',
              totalProductos: 12,
            },
            { id: 6, slug: 'bebidas', nombre: 'Bebidas', totalProductos: 18 },
          ],
        },
      ]);
    });

    it('sin filtros no acota los conteos', async () => {
      const { service, findTree } = build();

      await service.findAll({});

      expect(findTree).toHaveBeenCalledWith({
        supplierIds: undefined,
        brandIds: undefined,
      });
    });

    it('pasa proveedor y marca (plural con prioridad sobre el singular)', async () => {
      const { service, findTree } = build();

      await service.findAll({
        supplierIds: [1, 2],
        supplierId: 9,
        brandId: 7,
      });

      expect(findTree).toHaveBeenCalledWith({
        supplierIds: [1, 2],
        brandIds: [7],
      });
    });

    it('devuelve lista vacía si no hay categorías con productos', async () => {
      const { service } = build([]);

      await expect(service.findAll({})).resolves.toEqual([]);
    });
  });

  describe('findBySlug', () => {
    it('devuelve la categoría y acota la consulta a su slug', async () => {
      const { service, findTree } = build();

      const result = await service.findBySlug('alimentos');

      expect(result.nombre).toBe('Alimentos');
      expect(findTree).toHaveBeenCalledWith({ categorySlug: 'alimentos' });
    });

    it('404 si no existe, está oculta o no tiene productos activos', async () => {
      const { service } = build([]);

      await expect(service.findBySlug('nada')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404 sin consultar si el slug está mal formado', async () => {
      const { service, findTree } = build();

      await expect(service.findBySlug('Mal Slug!')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(findTree).not.toHaveBeenCalled();
    });
  });
});
