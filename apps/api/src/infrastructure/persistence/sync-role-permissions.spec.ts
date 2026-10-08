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
    // Quyền cũ do test tách quyền cận lâm sàng (#215) tự tạo — gỡ để không lọt sang spec khác.
    await privileged.permission.deleteMany({ where: { module: 'paraclinical_result' } });
    // "Hàng đợi ảo" (#064) — seedDefaultRolesForTenant() nay cũng seed Khoa mặc định ("Khoa
    // chung"), FK RESTRICT department→tenant nên phải xoá trước tenant.
    await privileged.department.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    // "Thu chi tại quầy" GĐ1 — seedDefaultRolesForTenant() nay cũng seed 1 quỹ tiền mặt mặc định
    // (cash_account) qua CodeSequenceRepository (code_sequence) — cả hai FK RESTRICT→tenant.
    await privileged.cashAccount.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    // Kho Thuốc & Vật tư y tế GĐ1 (docs/DECISIONS.md #146) — seedDefaultRolesForTenant() nay cũng
    // seed 1 Kho mặc định (warehouse), cùng FK RESTRICT→tenant như cash_account ở trên.
    await privileged.warehouse.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
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

  it('tenant cũ thiếu 2 vai trò Kỹ thuật viên (#215): sync tạo vai trò hệ thống + cấp đúng ma trận; gọi lại không tạo trùng', async () => {
    const technicianNames = ['lab_technician', 'imaging_technician'];
    const existing = await privileged.role.findMany({ where: { tenantId: tenantAId, name: { in: technicianNames } } });
    await privileged.rolePermission.deleteMany({ where: { tenantId: tenantAId, roleId: { in: existing.map((r) => r.id) } } });
    await privileged.role.deleteMany({ where: { tenantId: tenantAId, name: { in: technicianNames } } });

    await unitOfWork.runInTenantScope(tenantAId, (tx) => syncRolePermissionsForTenant(tx, tenantAId, SYSTEM_ACTOR));

    for (const name of technicianNames) {
      const role = await privileged.role.findFirstOrThrow({ where: { tenantId: tenantAId, name } });
      expect(role.isSystemDefault).toBe(true);
      const granted = await privileged.rolePermission.findMany({ where: { tenantId: tenantAId, roleId: role.id, deletedAt: null }, include: { permission: true } });
      expect(granted.map((g) => `${g.permission.module}.${g.permission.action}`).sort()).toEqual(Object.keys(DEFAULT_ROLE_PERMISSIONS[name as 'lab_technician' | 'imaging_technician']).sort());
    }
    await unitOfWork.runInTenantScope(tenantAId, (tx) => syncRolePermissionsForTenant(tx, tenantAId, SYSTEM_ACTOR));
    expect(await privileged.role.count({ where: { tenantId: tenantAId, name: { in: technicianNames } } })).toBe(2);
  });

  it('tách quyền cận lâm sàng (#215): vai trò tuỳ biến có paraclinical_result.<hành động> được cấp lại cho CẢ lab_result và imaging_result cùng phạm vi, dòng cũ bị thu hồi; gọi lại không đổi gì', async () => {
    const legacyRead = await privileged.permission.upsert({ where: { module_action: { module: 'paraclinical_result', action: 'read' } }, create: { module: 'paraclinical_result', action: 'read', description: 'legacy' }, update: {} });
    const legacyEnter = await privileged.permission.upsert({ where: { module_action: { module: 'paraclinical_result', action: 'enter' } }, create: { module: 'paraclinical_result', action: 'enter', description: 'legacy' }, update: {} });
    const custom = await privileged.role.create({ data: { tenantId: tenantAId, name: `ktv-cu-${randomUUID().slice(0, 6)}`, isSystemDefault: false, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR } });
    await privileged.rolePermission.createMany({
      data: [
        { tenantId: tenantAId, roleId: custom.id, permissionId: legacyRead.id, dataScope: 'department', createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
        { tenantId: tenantAId, roleId: custom.id, permissionId: legacyEnter.id, dataScope: 'global', createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
      ],
    });

    await unitOfWork.runInTenantScope(tenantAId, (tx) => syncRolePermissionsForTenant(tx, tenantAId, SYSTEM_ACTOR));

    const rows = await privileged.rolePermission.findMany({ where: { tenantId: tenantAId, roleId: custom.id }, include: { permission: true } });
    const live = Object.fromEntries(rows.filter((r) => r.deletedAt === null).map((r) => [`${r.permission.module}.${r.permission.action}`, r.dataScope]));
    expect(live).toEqual({
      'lab_result.read': 'department',
      'imaging_result.read': 'department',
      'lab_result.enter': 'global',
      'imaging_result.enter': 'global',
    });
    expect(rows.filter((r) => r.permission.module === 'paraclinical_result').every((r) => r.deletedAt !== null)).toBe(true);

    await unitOfWork.runInTenantScope(tenantAId, (tx) => syncRolePermissionsForTenant(tx, tenantAId, SYSTEM_ACTOR));
    const again = await privileged.rolePermission.count({ where: { tenantId: tenantAId, roleId: custom.id, deletedAt: null } });
    expect(again).toBe(4);
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
