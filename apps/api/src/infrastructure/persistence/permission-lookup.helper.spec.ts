import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from './prisma.service';
import { UnitOfWorkService } from './unit-of-work.service';
import { findScopesForUserPermission } from './permission-lookup.helper';
import { seedPermissionCatalog } from './seed-permissions';
import { seedDefaultRolesForTenant } from './seed-tenant-roles';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';

/**
 * Bug thật phát hiện 2026-09-04: `findScopesForUserPermission` (dùng bởi `PermissionGuard` cho
 * MỌI endpoint được bảo vệ) thiếu `deletedAt: null` ở cả `role_permission` lẫn `user_role` lồng
 * bên trong — quyền đã thu hồi qua "Vai trò & Phân quyền" (soft-delete) hoặc vai trò đã gỡ khỏi
 * tài khoản (soft-delete) vẫn còn hiệu lực vĩnh viễn, làm bảng phân quyền chỉ CẤP thêm được chứ
 * không THU HỒI được. Test này xác nhận cả 2 nhánh đã sửa đúng.
 */
describe('findScopesForUserPermission — tôn trọng soft-delete (bug 2026-09-04)', () => {
  let privileged: PrismaClient;
  let appPrisma: PrismaService;
  let unitOfWork: UnitOfWorkService;
  let fixture: TwoTenantFixture;
  let userId: string;
  let doctorRoleId: string;
  let encounterReadPermissionId: string;

  beforeAll(async () => {
    appPrisma = new PrismaService();
    await appPrisma.$connect();
    unitOfWork = new UnitOfWorkService(appPrisma);

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();
    await seedPermissionCatalog(privileged);

    fixture = await createTwoTenantFixture(privileged, 'PermLookup');
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);

    const doctorRole = await privileged.role.findFirstOrThrow({ where: { tenantId: fixture.tenantA.id, name: 'doctor' } });
    doctorRoleId = doctorRole.id;
    const encounterReadPermission = await privileged.permission.findFirstOrThrow({ where: { module: 'encounter', action: 'read' } });
    encounterReadPermissionId = encounterReadPermission.id;

    const passwordHash = await argon2.hash('Test@12345', { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: {
        tenantId: fixture.tenantA.id,
        username: `perm-lookup-${randomUUID()}`,
        passwordHash,
        fullName: 'BS Test PermLookup',
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    userId = user.id;
    await privileged.userRole.create({
      data: { tenantId: fixture.tenantA.id, userId, roleId: doctorRoleId, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  it('doctor mặc định có encounter.read = global', async () => {
    const scopes = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      findScopesForUserPermission(tx, fixture.tenantA.id, userId, 'encounter', 'read'),
    );
    expect(scopes).toEqual(['global']);
  });

  it('thu hồi quyền qua "Vai trò & Phân quyền" (soft-delete role_permission) → PermissionGuard không còn thấy quyền đó', async () => {
    await privileged.rolePermission.updateMany({
      where: { tenantId: fixture.tenantA.id, roleId: doctorRoleId, permissionId: encounterReadPermissionId },
      data: { deletedAt: new Date(), deletedReason: 'test_revoke' },
    });

    const scopes = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      findScopesForUserPermission(tx, fixture.tenantA.id, userId, 'encounter', 'read'),
    );
    expect(scopes).toEqual([]);
  });

  it('gỡ vai trò khỏi tài khoản (soft-delete user_role) → PermissionGuard không còn tính vai trò đó nữa', async () => {
    // Cấp lại quyền vừa thu hồi ở test trên để cô lập đúng điều kiện đang kiểm (chỉ còn phụ thuộc user_role).
    await privileged.rolePermission.updateMany({
      where: { tenantId: fixture.tenantA.id, roleId: doctorRoleId, permissionId: encounterReadPermissionId },
      data: { deletedAt: null, deletedReason: null },
    });
    await privileged.userRole.updateMany({
      where: { tenantId: fixture.tenantA.id, userId, roleId: doctorRoleId },
      data: { deletedAt: new Date(), deletedReason: 'test_unassign' },
    });

    const scopes = await unitOfWork.runInTenantScope(fixture.tenantA.id, (tx) =>
      findScopesForUserPermission(tx, fixture.tenantA.id, userId, 'encounter', 'read'),
    );
    expect(scopes).toEqual([]);
  });
});
