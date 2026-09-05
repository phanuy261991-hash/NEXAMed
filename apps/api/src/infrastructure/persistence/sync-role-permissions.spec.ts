import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS } from '@nexamed/core';
import { PrismaService } from './prisma.service';
import { UnitOfWorkService } from './unit-of-work.service';
import { seedPermissionCatalog } from './seed-permissions';
import { seedDefaultRolesForTenant } from './seed-tenant-roles';
import { syncRolePermissionsForAllTenants, syncRolePermissionsForTenant } from './sync-role-permissions';

// Xác minh cơ chế backfill role_permission cho tenant cũ (docs/CURRENT.md mục "Đang chờ",
// chạy tự động lúc API khởi động — xem main.ts). Mô phỏng "tenant cũ thiếu permission mới"
// bằng cách xoá bớt role_permission sau khi seed đủ.

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

describe('syncRolePermissionsForTenant / ForAllTenants', () => {
  const privileged = new PrismaClient({
    datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } },
  });
  const appPrisma = new PrismaService();
  const unitOfWork = new UnitOfWorkService(appPrisma);

  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();
    await seedPermissionCatalog(privileged);

    const tenantA = await privileged.tenant.create({
      data: { name: `SyncPerm A ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    const tenantB = await privileged.tenant.create({
      data: { name: `SyncPerm B ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    await seedDefaultRolesForTenant(privileged, tenantAId, SYSTEM_ACTOR);
    await seedDefaultRolesForTenant(privileged, tenantBId, SYSTEM_ACTOR);
  });

  afterAll(async () => {
    await privileged.rolePermission.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.role.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    // "Hàng đợi ảo" (#064) — seedDefaultRolesForTenant() nay cũng seed Khoa mặc định ("Khoa
    // chung"), FK RESTRICT department→tenant nên phải xoá trước tenant.
    await privileged.department.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    // "Thu chi tại quầy" GĐ1 — seedDefaultRolesForTenant() nay cũng seed 1 quỹ tiền mặt mặc định
    // (cash_account) qua CodeSequenceRepository (code_sequence) — cả hai FK RESTRICT→tenant.
    await privileged.cashAccount.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.codeSequence.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  it('tenant đã seed đủ (đúng ngay từ đầu) — không thêm gì, idempotent', async () => {
    const added = await unitOfWork.runInTenantScope(tenantAId, (tx) =>
      syncRolePermissionsForTenant(tx, tenantAId, SYSTEM_ACTOR),
    );
    expect(added).toEqual([]);
  });

  it('vá đúng dòng role_permission bị thiếu (mô phỏng tenant cũ thiếu permission mới), đúng data_scope theo ma trận', async () => {
    const doctorRole = await privileged.role.findFirstOrThrow({ where: { tenantId: tenantAId, name: 'doctor' } });
    const encounterReadPermission = await privileged.permission.findFirstOrThrow({
      where: { module: 'encounter', action: 'read' },
    });

    // Mô phỏng: tenant được tạo trước khi permission "encounter.read" tồn tại.
    await privileged.rolePermission.deleteMany({
      where: { tenantId: tenantAId, roleId: doctorRole.id, permissionId: encounterReadPermission.id },
    });
    const before = await privileged.rolePermission.findMany({ where: { tenantId: tenantAId, roleId: doctorRole.id } });
    expect(before.some((rp) => rp.permissionId === encounterReadPermission.id)).toBe(false);

    const added = await unitOfWork.runInTenantScope(tenantAId, (tx) =>
      syncRolePermissionsForTenant(tx, tenantAId, SYSTEM_ACTOR),
    );
    expect(added).toEqual([`${tenantAId}/doctor/encounter.read`]);

    const restored = await privileged.rolePermission.findFirst({
      where: { tenantId: tenantAId, roleId: doctorRole.id, permissionId: encounterReadPermission.id },
    });
    expect(restored?.dataScope).toBe(DEFAULT_ROLE_PERMISSIONS.doctor['encounter.read']);
    expect(restored?.createdBy).toBe(SYSTEM_ACTOR);

    // Gọi lại lần 2 không tạo trùng dòng.
    const addedAgain = await unitOfWork.runInTenantScope(tenantAId, (tx) =>
      syncRolePermissionsForTenant(tx, tenantAId, SYSTEM_ACTOR),
    );
    expect(addedAgain).toEqual([]);
    const finalCount = await privileged.rolePermission.count({
      where: { tenantId: tenantAId, roleId: doctorRole.id, permissionId: encounterReadPermission.id },
    });
    expect(finalCount).toBe(1);
  });

  it('không đụng vai trò tuỳ biến (is_system_default = false)', async () => {
    const customRole = await privileged.role.create({
      data: {
        tenantId: tenantAId,
        name: `custom-${randomUUID().slice(0, 8)}`,
        isSystemDefault: false,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });

    const added = await unitOfWork.runInTenantScope(tenantAId, (tx) =>
      syncRolePermissionsForTenant(tx, tenantAId, SYSTEM_ACTOR),
    );
    expect(added.some((key) => key.includes(customRole.name))).toBe(false);

    const rolePermissions = await privileged.rolePermission.findMany({ where: { roleId: customRole.id } });
    expect(rolePermissions).toHaveLength(0);
  });

  it('ForAllTenants chỉ vá đúng tenant thiếu, cách ly tenant khác', async () => {
    const nurseRoleA = await privileged.role.findFirstOrThrow({ where: { tenantId: tenantAId, name: 'nurse' } });
    const vitalSignPermission = await privileged.permission.findFirstOrThrow({
      where: { module: 'vital_sign', action: 'create' },
    });
    await privileged.rolePermission.deleteMany({
      where: { tenantId: tenantAId, roleId: nurseRoleA.id, permissionId: vitalSignPermission.id },
    });

    const added = await syncRolePermissionsForAllTenants(appPrisma, unitOfWork, SYSTEM_ACTOR);
    expect(added).toContain(`${tenantAId}/nurse/vital_sign.create`);
    expect(added.some((key) => key.startsWith(`${tenantBId}/`))).toBe(false);
  });
});
