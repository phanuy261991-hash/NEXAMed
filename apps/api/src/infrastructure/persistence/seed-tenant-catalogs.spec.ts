import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedTenantDefaultCatalogs } from './seed-tenant-catalogs';
import { seedSystemReferenceDataForTenant } from './seed-reference-catalog';

/**
 * Cấp danh mục mặc định cho tenant mới (docs/DECISIONS.md #230) — điểm vào cho script tạo tenant pilot/dev và luồng cấp tenant tự động
 * của SaaS: đủ danh mục + dòng hệ thống, idempotent, không ghi đè chỉnh sửa của tenant, không đụng tenant khác.
 */
describe('seedTenantDefaultCatalogs — danh mục mặc định theo tenant', () => {
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();
    fixture = await createTwoTenantFixture(privileged, 'SeedCatalogs');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
  });

  const count = (tenantId: string, category: string) => privileged.referenceCatalog.count({ where: { tenantId, category: category as never } });

  it('nạp đủ danh mục + dị nguyên cho tenant, tenant còn lại không bị đụng', async () => {
    await seedTenantDefaultCatalogs(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);

    expect(await count(fixture.tenantA.id, 'ETHNICITY')).toBe(54);
    expect(await count(fixture.tenantA.id, 'NATIONALITY')).toBe(30);
    expect(await count(fixture.tenantA.id, 'ICD10_ABBREVIATION')).toBe(11);
    expect(await count(fixture.tenantA.id, 'UNIT')).toBeGreaterThan(0);
    expect(await count(fixture.tenantA.id, 'LAB_RESULT_UNIT')).toBe(20);
    const methods = await privileged.referenceCatalog.findMany({ where: { tenantId: fixture.tenantA.id, category: 'PAYMENT_METHOD' }, orderBy: { sortOrder: 'asc' } });
    expect(methods.map((m) => [m.code, m.countsAsCash])).toEqual([['CASH', true], ['BANK_TRANSFER', false], ['WALLET', false]]);
    expect(await privileged.allergenGroup.count({ where: { tenantId: fixture.tenantA.id } })).toBeGreaterThan(0);
    expect(await privileged.allergen.count({ where: { tenantId: fixture.tenantA.id } })).toBeGreaterThan(0);

    expect(await privileged.referenceCatalog.count({ where: { tenantId: fixture.tenantB.id } })).toBe(0);
    expect(await privileged.allergen.count({ where: { tenantId: fixture.tenantB.id } })).toBe(0);
  });

  it('chạy lại không tạo trùng và KHÔNG ghi đè chỉnh sửa/ẩn của tenant', async () => {
    const before = await privileged.referenceCatalog.count({ where: { tenantId: fixture.tenantA.id } });
    const allergensBefore = await privileged.allergen.count({ where: { tenantId: fixture.tenantA.id } });
    await privileged.referenceCatalog.updateMany({ where: { tenantId: fixture.tenantA.id, category: 'ETHNICITY', code: '1' }, data: { name: 'Kinh (đã đổi tên)' } });
    await privileged.referenceCatalog.updateMany({ where: { tenantId: fixture.tenantA.id, category: 'PAYMENT_METHOD', code: 'BANK_TRANSFER' }, data: { isActive: false } });

    await seedTenantDefaultCatalogs(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);

    expect(await privileged.referenceCatalog.count({ where: { tenantId: fixture.tenantA.id } })).toBe(before);
    expect(await privileged.allergen.count({ where: { tenantId: fixture.tenantA.id } })).toBe(allergensBefore);
    const kinh = await privileged.referenceCatalog.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, category: 'ETHNICITY', code: '1' } });
    expect(kinh.name).toBe('Kinh (đã đổi tên)');
    const bank = await privileged.referenceCatalog.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, category: 'PAYMENT_METHOD', code: 'BANK_TRANSFER' } });
    expect(bank.isActive).toBe(false);
  });

  it('bản hệ thống nhẹ (seedSystemReferenceDataForTenant) chỉ nạp dòng bắt buộc cho tenant', async () => {
    await seedSystemReferenceDataForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    expect(await privileged.referenceCatalog.count({ where: { tenantId: fixture.tenantB.id } })).toBe(3 + 3 + 11);
    expect(await count(fixture.tenantB.id, 'ETHNICITY')).toBe(0);
  });

  it('mã tự sinh của danh mục tiếp tục theo bộ đếm RIÊNG của tenant (CATALOG:*) sau khi nạp mặc định', async () => {
    const units = await privileged.referenceCatalog.findMany({ where: { tenantId: fixture.tenantA.id, category: 'UNIT' }, select: { code: true } });
    const seq = await privileged.codeSequence.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, prefix: 'CATALOG:DV' } });
    expect(Number(seq.currentValue)).toBe(units.length);
    expect(await privileged.codeSequence.count({ where: { tenantId: fixture.tenantB.id, prefix: 'CATALOG:DV' } })).toBe(0);
  });
});
