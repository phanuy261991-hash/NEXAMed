import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { UnitOfWorkService } from './unit-of-work.service';
import { CodeSequenceRepository } from './code-sequence.repository';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';

describe('CodeSequenceRepository — cấp mã tuần tự theo tenant', () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService();
  const unitOfWork = new UnitOfWorkService(appPrisma);
  const repository = new CodeSequenceRepository();

  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();
    fixture = await createTwoTenantFixture(privileged, 'CodeSeq');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  it('tăng dần 1, 2, 3... cho cùng prefix trong cùng tenant', async () => {
    const first = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      repository.next(tx, fixture.tenantA.id, 'BN', SYSTEM_TEST_ACTOR),
    );
    const second = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      repository.next(tx, fixture.tenantA.id, 'BN', SYSTEM_TEST_ACTOR),
    );
    const third = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      repository.next(tx, fixture.tenantA.id, 'BN', SYSTEM_TEST_ACTOR),
    );
    expect(first).toBe(1n);
    expect(second).toBe(2n);
    expect(third).toBe(3n);
  });

  it('mỗi tenant có bộ đếm riêng dù cùng prefix — không cộng dồn xuyên tenant', async () => {
    const tenantAValue = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      repository.next(tx, fixture.tenantA.id, 'ENC', SYSTEM_TEST_ACTOR),
    );
    const tenantBValue = await unitOfWork.runInTenantScope(fixture.tenantB.id, (tx) =>
      repository.next(tx, fixture.tenantB.id, 'ENC', SYSTEM_TEST_ACTOR),
    );
    expect(tenantAValue).toBe(1n);
    expect(tenantBValue).toBe(1n);
  });

  it('cấp đồng thời nhiều lần cho cùng tenant+prefix vẫn ra các số khác nhau, không trùng', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
          repository.next(tx, fixture.tenantA.id, 'CONCURRENT', SYSTEM_TEST_ACTOR),
        ),
      ),
    );
    const unique = new Set(results.map((v) => v.toString()));
    expect(unique.size).toBe(10);
  });

  it('periodKey khác nhau (docs/DECISIONS.md #114) → bộ đếm độc lập, không cộng dồn chéo chu kỳ', async () => {
    const period1First = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      repository.next(tx, fixture.tenantA.id, 'PERIODIC', SYSTEM_TEST_ACTOR, { periodKey: '202609' }),
    );
    const period1Second = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      repository.next(tx, fixture.tenantA.id, 'PERIODIC', SYSTEM_TEST_ACTOR, { periodKey: '202609' }),
    );
    const period2First = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      repository.next(tx, fixture.tenantA.id, 'PERIODIC', SYSTEM_TEST_ACTOR, { periodKey: '202610' }),
    );
    expect(period1First).toBe(1n);
    expect(period1Second).toBe(2n);
    expect(period2First).toBe(1n); // chu kỳ mới tự bắt đầu lại từ 1, không tiếp nối chu kỳ trước
  });

  it('initialValueIfNeverUsed: chỉ áp dụng cho lần cấp ĐẦU TIÊN trên toàn bộ lịch sử prefix, chu kỳ sau vẫn bắt đầu lại từ 1', async () => {
    const bootstrap = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      repository.next(tx, fixture.tenantA.id, 'BOOTSTRAP', SYSTEM_TEST_ACTOR, {
        periodKey: '2026',
        initialValueIfNeverUsed: 3000n,
      }),
    );
    const nextSamePeriod = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      repository.next(tx, fixture.tenantA.id, 'BOOTSTRAP', SYSTEM_TEST_ACTOR, {
        periodKey: '2026',
        initialValueIfNeverUsed: 9999n, // bị bỏ qua — prefix này đã có dòng rồi
      }),
    );
    const nextPeriod = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      repository.next(tx, fixture.tenantA.id, 'BOOTSTRAP', SYSTEM_TEST_ACTOR, {
        periodKey: '2027',
        initialValueIfNeverUsed: 9999n, // vẫn bị bỏ qua — chu kỳ mới luôn bắt đầu lại từ 1
      }),
    );
    expect(bootstrap).toBe(3000n);
    expect(nextSamePeriod).toBe(3001n);
    expect(nextPeriod).toBe(1n);
  });

  it('hasEverBeenUsed/peekCurrentValue phản ánh đúng trạng thái, không cấp số mới', async () => {
    const beforeUsed = await unitOfWork.runInTenantScope(fixture.tenantB.id, (tx) => repository.hasEverBeenUsed(tx, fixture.tenantB.id, 'PEEK'));
    expect(beforeUsed).toBe(false);

    await unitOfWork.runInTenantScope(fixture.tenantB.id, (tx) => repository.next(tx, fixture.tenantB.id, 'PEEK', SYSTEM_TEST_ACTOR, { periodKey: '2026' }));

    const afterUsed = await unitOfWork.runInTenantScope(fixture.tenantB.id, (tx) => repository.hasEverBeenUsed(tx, fixture.tenantB.id, 'PEEK'));
    const peeked = await unitOfWork.runInTenantScope(fixture.tenantB.id, (tx) => repository.peekCurrentValue(tx, fixture.tenantB.id, 'PEEK', '2026'));
    const peekedOtherPeriod = await unitOfWork.runInTenantScope(fixture.tenantB.id, (tx) =>
      repository.peekCurrentValue(tx, fixture.tenantB.id, 'PEEK', '2099'),
    );
    expect(afterUsed).toBe(true);
    expect(peeked).toBe(1n);
    expect(peekedOtherPeriod).toBeNull();
  });
});
