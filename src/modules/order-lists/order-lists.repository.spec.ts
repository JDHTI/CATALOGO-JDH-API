import type { PrismaService } from '@infrastructure/database';
import { OrderListsRepository } from './order-lists.repository';

it('espera fuera del pool por usuario, permite otros usuarios y libera después de un fallo', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: string[] = [];
  const counts = new Map<string, number>();
  const transaction = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    orderList: {
      count: jest.fn(({ where }: { where: { userId: string } }) => {
        started.push(where.userId);
        const count = counts.get(where.userId) ?? 0;
        counts.set(where.userId, count + 1);
        if (where.userId === 'a' && count === 0)
          return blocked.then(() => {
            throw new Error('fallo BD');
          });
        return Promise.resolve(10);
      }),
    },
  };
  const prisma = {
    $transaction: (work: (tx: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as unknown as PrismaService;
  const repository = new OrderListsRepository(prisma);
  const first = repository.create('a', 'Primera');
  const failed = expect(first).rejects.toThrow('fallo BD');
  const second = repository.create('a', 'Segunda');
  await expect(repository.create('b', 'Independiente')).resolves.toBeNull();
  expect(started).toEqual(['a', 'b']);
  release();
  await failed;
  await expect(second).resolves.toBeNull();
  await expect(repository.create('a', 'Tercera')).resolves.toBeNull();
  expect(started).toEqual(['a', 'b', 'a', 'a']);
});
