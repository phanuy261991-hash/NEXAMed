import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, permissionKey } from '@nexamed/core';
import { USER_ROLES } from '@nexamed/shared';

/**
 * Seed 5 vai trò mặc định (is_system_default = true) + ma trận role_permission, VÀ Khoa mặc định
 * ("Khoa chung", `docs/DECISIONS.md` #064) cho MỘT tenant, theo DEFAULT_ROLE_PERMISSIONS
 * (packages/core/src/rbac/permissions.ts). Gọi khi tạo tenant mới (chưa có module tạo tenant —
 * S2+) và dùng lại trong test. Khoa mặc định là điều kiện tiên quyết cho "Hàng đợi ảo" —
 * `encounter.departmentId` bắt buộc NOT NULL, mọi tenant phải có sẵn ít nhất 1 Khoa trước khi có
 * lượt khám đầu tiên.
 *
 * Yêu cầu: danh mục `permission` đã được seed trước (xem seed-permissions.ts) — hàm này
 * không tự tạo permission.
 */
export async function seedDefaultRolesForTenant(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
  actorId: string,
): Promise<void> {
  const existingDefaultDepartment = await tx.department.findFirst({ where: { tenantId, isDefault: true } });
  if (!existingDefaultDepartment) {
    await tx.department.create({
      data: { tenantId, name: 'Khoa chung', code: null, isDefault: true, isActive: true, createdBy: actorId, updatedBy: actorId },
    });
  }

  const permissions = await tx.permission.findMany();
  const permissionIdByKey = new Map(permissions.map((p) => [permissionKey(p), p.id]));

  for (const roleName of USER_ROLES) {
    const role = await tx.role.create({
      data: {
        tenantId,
        name: roleName,
        isSystemDefault: true,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });

    const matrix = DEFAULT_ROLE_PERMISSIONS[roleName];
    for (const key of Object.keys(matrix)) {
      const dataScope = matrix[key];
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId || !dataScope) {
        throw new Error(`DEFAULT_ROLE_PERMISSIONS tham chiếu permission chưa seed: "${key}"`);
      }
      await tx.rolePermission.create({
        data: {
          tenantId,
          roleId: role.id,
          permissionId,
          dataScope,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    }
  }
}