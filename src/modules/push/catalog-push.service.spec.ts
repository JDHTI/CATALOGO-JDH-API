import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '@infrastructure/database';

import { CatalogPushService } from './catalog-push.service';
import { createRemoteCatalogClient } from './remote-catalog.client';

// Se conserva el `assertDistinctDatabases` real: es una de las garantías que
// se quieren probar. Solo se sustituye la apertura del cliente remoto.
jest.mock('./remote-catalog.client', () => ({
  ...jest.requireActual<object>('./remote-catalog.client'),
  createRemoteCatalogClient: jest.fn(),
}));

const LOCAL_URL = 'postgresql://u:p@localhost:5435/jdh_catalogo?schema=public';
const TARGET_URL = 'postgresql://u:p@caboose.proxy.rlwy.net:41234/railway';

type Row = Record<string, unknown>;

interface OrderBy {
  [field: string]: 'asc' | 'desc';
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;

  return Object.entries(where).every(([field, cond]) => {
    const value = row[field];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const operators = cond as Record<string, unknown>;
      if ('in' in operators) {
        return (operators.in as unknown[]).includes(value);
      }
      if ('lt' in operators) {
        return (value as Date).getTime() < (operators.lt as Date).getTime();
      }
      if ('gt' in operators) {
        return (value as number) > (operators.gt as number);
      }
      throw new Error(`Condición no soportada por el doble: ${field}`);
    }
    return value === cond;
  });
}

/** Tabla en memoria con lo justo del contrato de Prisma que usa el push. */
class FakeTable {
  readonly rows: Row[] = [];
  private nextId = 1;

  constructor(seed: Row[] = []) {
    for (const row of seed) this.insert(row);
  }

  private insert(row: Row): Row {
    const id = typeof row.id === 'number' ? row.id : this.nextId;
    this.nextId = Math.max(this.nextId, id + 1);
    const stored: Row = { ...row, id };
    this.rows.push(stored);
    return stored;
  }

  findMany = jest.fn(
    (args?: {
      where?: Row;
      orderBy?: OrderBy | OrderBy[];
      take?: number;
    }): Promise<Row[]> => {
      let result = this.rows.filter((row) => matches(row, args?.where));

      const orderBy = args?.orderBy;
      if (orderBy) {
        const criteria = Array.isArray(orderBy) ? orderBy : [orderBy];
        result = [...result].sort((a, b) => {
          for (const criterion of criteria) {
            const [field, direction] = Object.entries(criterion)[0];
            const left = a[field] as number | string;
            const right = b[field] as number | string;
            if (left === right) continue;
            const sign = left < right ? -1 : 1;
            return direction === 'asc' ? sign : -sign;
          }
          return 0;
        });
      }

      if (args?.take !== undefined) result = result.slice(0, args.take);
      return Promise.resolve(result.map((row) => ({ ...row })));
    },
  );

  create = jest.fn((args: { data: Row }): Promise<Row> =>
    Promise.resolve({ ...this.insert(args.data) }),
  );

  createMany = jest.fn((args: { data: Row[] }): Promise<{ count: number }> => {
    for (const row of args.data) this.insert(row);
    return Promise.resolve({ count: args.data.length });
  });

  update = jest.fn(
    (args: { where: { id: number }; data: Row }): Promise<Row> => {
      const row = this.rows.find((candidate) => candidate.id === args.where.id);
      if (!row) throw new Error(`Fila ${args.where.id} inexistente`);
      Object.assign(row, args.data);
      return Promise.resolve({ ...row });
    },
  );

  updateMany = jest.fn(
    (args: { where?: Row; data: Row }): Promise<{ count: number }> => {
      const affected = this.rows.filter((row) => matches(row, args.where));
      for (const row of affected) Object.assign(row, args.data);
      return Promise.resolve({ count: affected.length });
    },
  );

  deleteMany = jest.fn((args: { where?: Row }): Promise<{ count: number }> => {
    const survivors = this.rows.filter((row) => !matches(row, args.where));
    const removed = this.rows.length - survivors.length;
    this.rows.length = 0;
    this.rows.push(...survivors);
    return Promise.resolve({ count: removed });
  });

  count = jest.fn((): Promise<number> => Promise.resolve(this.rows.length));
}

interface FakeCatalog {
  supplier: FakeTable;
  brand: FakeTable;
  manufacturer: FakeTable;
  category: FakeTable;
  subcategory: FakeTable;
  product: FakeTable;
  productImage: FakeTable;
  syncRun: FakeTable;
  $connect: jest.Mock;
  $disconnect: jest.Mock;
}

const buildCatalog = (
  seed: Partial<Record<keyof FakeCatalog, Row[]>> = {},
): FakeCatalog => ({
  supplier: new FakeTable(seed.supplier),
  brand: new FakeTable(seed.brand),
  manufacturer: new FakeTable(seed.manufacturer),
  category: new FakeTable(seed.category),
  subcategory: new FakeTable(seed.subcategory),
  product: new FakeTable(seed.product),
  productImage: new FakeTable(seed.productImage),
  syncRun: new FakeTable(seed.syncRun),
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
});

const buildProduct = (overrides: Row = {}): Row => ({
  productoKey: 'KEY-1',
  sku: 'SKU-1',
  name: 'PRODUCTO UNO',
  shortDescription: null,
  tipoItem: 'Inventario',
  origen: null,
  linea: null,
  sublinea: null,
  grupo: null,
  pesoKg: null,
  factorEmpaque: null,
  active: true,
  supplierId: 10,
  brandId: 20,
  manufacturerId: null,
  categoryId: null,
  subcategoryId: null,
  price: null,
  priceCurrency: 'COP',
  priceUpdatedAt: null,
  dwhCreatedAt: null,
  sourceHash: 'hash-local',
  syncedAt: new Date('2026-09-01T00:00:00Z'),
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
});

const buildService = (
  local: FakeCatalog,
  remote: FakeCatalog | null,
  // `null` = sin destino configurado. No `undefined`: eso dispararía el valor
  // por defecto del parámetro y el caso a probar se perdería.
  target: string | null = TARGET_URL,
): CatalogPushService => {
  const targetDatabaseUrl = target ?? undefined;
  const pushConfig = {
    enabled: targetDatabaseUrl !== undefined,
    targetDatabaseUrl,
    batchSize: 2,
    connectionTimeoutMillis: 20_000,
    statementTimeoutMillis: 120_000,
  };

  const configService = {
    getOrThrow: jest.fn((key: string) =>
      key === 'push' ? pushConfig : { url: LOCAL_URL, logQueries: false },
    ),
  } as unknown as ConfigService;

  (createRemoteCatalogClient as jest.Mock).mockReturnValue(remote);

  return new CatalogPushService(
    local as unknown as PrismaService,
    configService,
  );
};

describe('CatalogPushService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('se niega a correr sin base destino configurada', async () => {
    const service = buildService(buildCatalog(), null, null);

    await expect(service.run()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('se niega a empujar una base sobre sí misma', async () => {
    const service = buildService(buildCatalog(), buildCatalog(), LOCAL_URL);

    await expect(service.run()).rejects.toThrow(/MISMA base/);
  });

  it('avisa con claridad cuando el destino no tiene el esquema aplicado', async () => {
    const remote = buildCatalog();
    remote.product.count.mockRejectedValue(
      new Error('relation "products" does not exist'),
    );
    const service = buildService(buildCatalog(), remote);

    await expect(service.run()).rejects.toThrow(/migrate deploy/);
  });

  describe('publicación del catálogo', () => {
    const seedLocal = (): FakeCatalog =>
      buildCatalog({
        supplier: [
          {
            id: 10,
            code: 'P01',
            name: 'ACME',
            active: true,
            logoObjectKey: 'logos/acme.webp',
            logoUrl: 'https://cdn/acme.webp',
          },
        ],
        brand: [{ id: 20, name: 'MARCA', logoObjectKey: null, logoUrl: null }],
        product: [buildProduct()],
        productImage: [
          {
            id: 30,
            productId: 1,
            objectKey: 'products/P01/SKU-1/abc',
            originalObjectKey: 'originals/abc.jpg',
            url: 'https://cdn/card.webp',
            thumbUrl: 'https://cdn/thumb.webp',
            cardUrl: 'https://cdn/card.webp',
            fullUrl: 'https://cdn/full.webp',
            sourceChecksum: 'checksum-1',
            sourceFilename: 'abc.jpg',
            width: 800,
            height: 800,
            bytes: 1234,
            alt: null,
            position: 0,
            isPrimary: true,
          },
        ],
      });

    it('remapea las llaves foráneas a los ids de la base destino', async () => {
      // El destino ya tiene otro proveedor, así que los ids NO coinciden con
      // los locales: es justo el caso que el push debe resolver.
      const remote = buildCatalog({
        supplier: [
          {
            id: 1,
            code: 'OTRO',
            name: 'PREEXISTENTE',
            active: true,
            logoObjectKey: null,
            logoUrl: null,
          },
        ],
      });
      const local = seedLocal();
      // El producto local apunta al proveedor 10 y a la marca 20.
      local.product.rows[0].id = 1;

      const summary = await buildService(local, remote).run();

      const pushed = remote.product.rows[0];
      const supplier = remote.supplier.rows.find((row) => row.code === 'P01')!;
      const brand = remote.brand.rows.find((row) => row.name === 'MARCA')!;

      expect(supplier.id).not.toBe(10);
      expect(pushed.supplierId).toBe(supplier.id);
      expect(pushed.brandId).toBe(brand.id);
      expect(summary.products.inserted).toBe(1);
      expect(summary.suppliers.inserted).toBe(1);
    });

    it('arrastra el logo del proveedor y las imágenes del producto', async () => {
      const remote = buildCatalog();
      const local = seedLocal();
      local.product.rows[0].id = 1;

      const summary = await buildService(local, remote).run();

      expect(remote.supplier.rows[0].logoUrl).toBe('https://cdn/acme.webp');
      expect(remote.productImage.rows).toHaveLength(1);
      expect(remote.productImage.rows[0]).toMatchObject({
        productId: remote.product.rows[0].id,
        cardUrl: 'https://cdn/card.webp',
        sourceChecksum: 'checksum-1',
        isPrimary: true,
      });
      expect(summary.images.inserted).toBe(1);
    });

    it('es idempotente: la segunda publicación no cambia ni duplica nada', async () => {
      const remote = buildCatalog();
      const local = seedLocal();
      local.product.rows[0].id = 1;

      await buildService(local, remote).run();
      const segunda = await buildService(local, remote).run();

      expect(remote.product.rows).toHaveLength(1);
      expect(remote.productImage.rows).toHaveLength(1);
      expect(remote.supplier.rows).toHaveLength(1);
      expect(segunda.products.inserted).toBe(0);
      expect(segunda.products.unchanged).toBe(1);
      expect(segunda.images.inserted).toBe(0);
      expect(segunda.images.unchanged).toBe(1);
      expect(segunda.productsDeactivated).toBe(0);
    });

    it('propaga los cambios locales al destino', async () => {
      const remote = buildCatalog();
      const local = seedLocal();
      local.product.rows[0].id = 1;

      await buildService(local, remote).run();
      local.product.rows[0].name = 'PRODUCTO UNO CORREGIDO';
      const segunda = await buildService(local, remote).run();

      expect(segunda.products.updated).toBe(1);
      expect(remote.product.rows[0].name).toBe('PRODUCTO UNO CORREGIDO');
    });

    it('desactiva en destino los productos que ya no existen en local', async () => {
      const remote = buildCatalog();
      const local = seedLocal();
      local.product.rows[0].id = 1;
      local.product.rows.push(buildProduct({ id: 2, productoKey: 'KEY-2' }));

      await buildService(local, remote).run();
      // Desaparece del origen: en destino se apaga, nunca se borra.
      local.product.rows.pop();
      const segunda = await buildService(local, remote).run();

      expect(remote.product.rows).toHaveLength(2);
      expect(segunda.productsDeactivated).toBe(1);
      const huerfano = remote.product.rows.find(
        (row) => row.productoKey === 'KEY-2',
      )!;
      expect(huerfano.active).toBe(false);
    });

    it('borra en destino las imágenes que se quitaron en local', async () => {
      const remote = buildCatalog();
      const local = seedLocal();
      local.product.rows[0].id = 1;

      await buildService(local, remote).run();
      local.productImage.rows.length = 0;
      const segunda = await buildService(local, remote).run();

      expect(remote.productImage.rows).toHaveLength(0);
      expect(segunda.imagesRemoved).toBe(1);
    });

    it('con --limit publica un subconjunto y NO desactiva el resto', async () => {
      const remote = buildCatalog();
      const local = seedLocal();
      local.product.rows[0].id = 1;
      local.product.rows.push(buildProduct({ id: 2, productoKey: 'KEY-2' }));
      local.product.rows.push(buildProduct({ id: 3, productoKey: 'KEY-3' }));

      const summary = await buildService(local, remote).run({ limit: 1 });

      expect(summary.products.read).toBe(1);
      expect(remote.product.rows).toHaveLength(1);
      // Lo crítico: una prueba de humo no puede apagar el catálogo entero.
      expect(summary.productsDeactivated).toBe(0);
      expect(remote.product.rows[0].active).toBe(true);
    });

    it('registra la corrida en la base destino', async () => {
      const remote = buildCatalog();
      const local = seedLocal();
      local.product.rows[0].id = 1;

      const summary = await buildService(local, remote).run();

      const run = remote.syncRun.rows[0];
      expect(run.type).toBe('catalog-push');
      expect(run.status).toBe('success');
      expect(run.inserted).toBe(1);
      expect(summary.runId).toBe(run.id);
    });

    it('deja el SyncRun en error y cierra la conexión si algo falla', async () => {
      const remote = buildCatalog();
      remote.product.createMany.mockRejectedValue(
        new Error('conexión perdida'),
      );
      const local = seedLocal();
      local.product.rows[0].id = 1;

      await expect(buildService(local, remote).run()).rejects.toThrow(
        'conexión perdida',
      );

      expect(remote.syncRun.rows[0].status).toBe('error');
      expect(remote.syncRun.rows[0].error).toBe('conexión perdida');
      expect(remote.$disconnect).toHaveBeenCalled();
    });
  });
});
