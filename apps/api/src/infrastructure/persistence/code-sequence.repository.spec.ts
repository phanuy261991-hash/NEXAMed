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
});
