import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { UnitOfWorkService } from './unit-of-work.service';
import { seedPermissionCatalog } from './seed-permissions';
import { seedDefaultRolesForTenant } from './seed-tenant-roles';
import { DEFAULT_ROLE_PERMISSIONS } from '@nexamed/core';

// Integration test thật trên Postgres cục bộ — xác minh seedDefaultRolesForTenant() và RLS
// trên các bảng RBAC mới (role, role_permission, department, break_glass_session), cộng
// permission là danh mục read-only cho role app. Xem docs/DECISIONS.md #013.

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

describe('RBAC: seed vai trò + RLS', () => {
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
      data: { name: `RBAC A ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    const tenantB = await privileged.tenant.create({
      data: { name: `RBAC B ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
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

  it('seed đủ 5 vai trò mặc định cho mỗi tenant, đúng số dòng role_permission theo ma trận', async () => {
    const rolesA = await privileged.role.findMany({ where: { tenantId: tenantAId } });
    expect(rolesA).toHaveLength(5);
    expect(rolesA.every((r) => r.isSystemDefault)).toBe(true);

    const doctorRole = rolesA.find((r) => r.name === 'doctor');
    expect(doctorRole).toBeDefined();

    const doctorPermissions = await privileged.rolePermission.findMany({
      where: { tenantId: tenantAId, roleId: doctorRole!.id },
    });
    expect(doctorPermissions).toHaveLength(Object.keys(DEFAULT_ROLE_PERMISSIONS.doctor).length);
  });

  it('RLS cách ly role/role_permission theo tenant', async () => {
    const rolesAsA = await unitOfWork.runInTenantScope(tenantAId, (tx) => tx.role.findMany());
    expect(rolesAsA).toHaveLength(5);
    expect(rolesAsA.every((r) => r.tenantId === tenantAId)).toBe(true);

    const rolesAsB = await unitOfWork.runInTenantScope(tenantBId, (tx) => tx.role.findMany());
    expect(rolesAsB).toHaveLength(5);
    expect(rolesAsB.every((r) => r.tenantId === tenantBId)).toBe(true);
  });

  it('doctor.encounter.read = global theo đúng quyết định trong security-audit.md', async () => {
    const rows = await unitOfWork.runInTenantScope(tenantAId, (tx) =>
      tx.rolePermission.findMany({
        where: { role: { name: 'doctor' } },
        include: { permission: true },
      }),
    );
    const encounterRead = rows.find((r) => r.permission.module === 'encounter' && r.permission.action === 'read');
    expect(encounterRead?.dataScope).toBe('global');
  });

  it('permission là danh mục dùng chung, role app đọc được nhưng không ghi được', async () => {
    const permissions = await appPrisma.permission.findMany();
    expect(permissions.length).toBeGreaterThanOrEqual(23);

    await expect(
      appPrisma.permission.create({
        data: { module: 'hack', action: 'attempt', description: 'không được phép' },
      }),
    ).rejects.toThrow();
  });
});