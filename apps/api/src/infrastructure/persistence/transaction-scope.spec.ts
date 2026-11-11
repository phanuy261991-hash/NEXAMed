import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NestedTransactionError, nestedTransactionGuardMode, reportNestedTransaction } from './transaction-scope';
import { PrismaService } from './prisma.service';
import { UnitOfWorkService } from './unit-of-work.service';

/**
 * Bộ phát hiện giao dịch lồng nhau lúc chạy (docs/DECISIONS.md #296). Dùng Postgres thật của testcontainers
 * (`src/testing/global-setup.ts`) vì cần xác nhận ngữ cảnh `AsyncLocalStorage` đi xuyên qua `prisma.$transaction`.
 */
describe('transaction-scope — phát hiện giao dịch lồng nhau', () => {
  const tenantId = randomUUID();
  let prisma: PrismaService;
  let uow: UnitOfWorkService;
  const savedMode = process.env.NESTED_TRANSACTION_GUARD;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    uow = new UnitOfWorkService(prisma);
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env.NESTED_TRANSACTION_GUARD;
    else process.env.NESTED_TRANSACTION_GUARD = savedMode;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('mặc định ở môi trường test là chế độ ném lỗi; production là cảnh báo; có thể tắt', () => {
    delete process.env.NESTED_TRANSACTION_GUARD;
    expect(nestedTransactionGuardMode()).toBe('throw');
    const savedEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(nestedTransactionGuardMode()).toBe('warn');
      process.env.NESTED_TRANSACTION_GUARD = 'off';
      expect(nestedTransactionGuardMode()).toBe('off');
    } finally {
      process.env.NODE_ENV = savedEnv;
    }
  });

  it('runInTenantScope lồng trong runInTenantScope → NestedTransactionError, giao dịch ngoài hoàn tác', async () => {
    await expect(
      uow.runInTenantScope(tenantId, async () => {
        await uow.runInTenantScope(tenantId, async (tx2) => tx2.$queryRaw`SELECT 1`);
      }),
    ).rejects.toBeInstanceOf(NestedTransactionError);
  });

  it('lồng gián tiếp qua nhiều tầng hàm bất đồng bộ vẫn bị phát hiện', async () => {
    const deep = async (n: number): Promise<void> => {
      if (n === 0) {
        await uow.runInTenantScope(tenantId, async (tx) => tx.$queryRaw`SELECT 1`);
        return;
      }
      await Promise.resolve();
      await deep(n - 1);
    };
    await expect(uow.runInTenantScope(tenantId, () => deep(4))).rejects.toBeInstanceOf(NestedTransactionError);
  });

  it('truy vấn bằng client gốc của Prisma (không phải tx) trong giao dịch → NestedTransactionError', async () => {
    await expect(
      uow.runInTenantScope(tenantId, async () => {
        await prisma.$queryRaw`SELECT 1`;
      }),
    ).rejects.toBeInstanceOf(NestedTransactionError);
  });

  it('truy vấn bằng chính tx thì KHÔNG bị coi là lồng', async () => {
    const rows = await uow.runInTenantScope(tenantId, (tx) => tx.$queryRaw<{ one: number }[]>`SELECT 1::int AS one`);
    expect(rows[0]?.one).toBe(1);
  });

  it('hai giao dịch NGANG HÀNG (tuần tự hoặc Promise.all ở ngoài) không bị coi là lồng', async () => {
    await uow.runInTenantScope(tenantId, (tx) => tx.$queryRaw`SELECT 1`);
    await uow.runInTenantScope(tenantId, (tx) => tx.$queryRaw`SELECT 2`);
    await Promise.all([uow.runInTenantScope(tenantId, (tx) => tx.$queryRaw`SELECT 3`), uow.runInTenantScope(tenantId, (tx) => tx.$queryRaw`SELECT 4`)]);
  });

  it('việc nền khởi động TRONG giao dịch nhưng chạy SAU khi nó đóng không bị coi là lồng', async () => {
    let later: Promise<void> = Promise.resolve();
    await uow.runInTenantScope(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT 1`;
      later = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          uow.runInTenantScope(tenantId, (tx2) => tx2.$queryRaw`SELECT 5`).then(() => resolve(), reject);
        }, 50);
      });
    });
    await expect(later).resolves.toBeUndefined();
  });

  // Hai ca dưới gọi thẳng hàm báo lỗi thay vì thật sự lồng giao dịch: ở chế độ warn/off việc lồng KHÔNG bị chặn nên request chiếm
  // 2 kết nối thật — với bể 1 kết nối (job CI `pool-stress`, TEST_DB_CONNECTION_LIMIT=1) nó tự khoá, đúng lỗi mà bộ phát hiện sinh ra
  // để chặn. Hành vi thật của hai chế độ chỉ là "có ném hay không", kiểm trực tiếp được.
  const outer = { active: true, openedAt: 'src/giả-lập.ts:1' };

  it('chế độ throw ném NestedTransactionError khi gọi trực tiếp', () => {
    delete process.env.NESTED_TRANSACTION_GUARD;
    expect(() => reportNestedTransaction('runInTenantScope', outer)).toThrow(NestedTransactionError);
    expect(() => reportNestedTransaction('prisma-client-query', outer, 'Drug.findMany')).toThrow(/Drug\.findMany/);
  });

  it('chế độ warn không ném lỗi (production chỉ ghi log)', () => {
    process.env.NESTED_TRANSACTION_GUARD = 'warn';
    expect(() => reportNestedTransaction('runInTenantScope', outer)).not.toThrow();
    expect(() => reportNestedTransaction('prisma-client-query', outer, 'Drug.findMany')).not.toThrow();
  });

  it('chế độ off tắt hẳn việc kiểm tra', () => {
    process.env.NESTED_TRANSACTION_GUARD = 'off';
    expect(() => reportNestedTransaction('runInTenantScope', outer)).not.toThrow();
  });
});
