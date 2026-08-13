import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, permissionKey } from '@nexamed/core';
import { USER_ROLES, type UserRole } from '@nexamed/shared';
import type { UnitOfWorkService } from './unit-of-work.service';

/**
 * Đồng bộ `role_permission` còn thiếu cho MỘT tenant, so với `DEFAULT_ROLE_PERMISSIONS`
 * (packages/core/src/rbac/permissions.ts) — chỉ THÊM dòng còn thiếu cho vai trò
 * `is_system_default=true`, không sửa/xoá dòng đã có (an toàn với tuỳ biến ADM-07 sau này) và
 * không đụng vai trò tuỳ biến do `clinic_admin` tự tạo.
 *
 * Bối cảnh: `seedDefaultRolesForTenant()` chỉ chạy lúc TẠO tenant — tenant đã tồn tại trước khi
 * một permission mới ra đời sẽ không tự có role_permission tương ứng (phát hiện thật lúc làm
 * reference_catalog, xem docs/CURRENT.md mục "Đang chờ" trước khi có hàm này).
 */
export async function syncRolePermissionsForTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  actorId: string,
): Promise<string[]> {
  const permissions = await tx.permission.findMany();
  const permissionIdByKey = new Map(permissions.map((p) => [permissionKey(p), p.id]));

  const roles = await tx.role.findMany({
    where: { tenantId, isSystemDefault: true, deletedAt: null },
  });

  const added: string[] = [];

  for (const role of roles) {
    if (!(USER_ROLES as readonly string[]).includes(role.name)) continue;
    const matrix = DEFAULT_ROLE_PERMISSIONS[role.name as UserRole];

    const existing = await tx.rolePermission.findMany({
      where: { tenantId, roleId: role.id, deletedAt: null },
      select: { permissionId: true },
    });
    const existingPermissionIds = new Set(existing.map((rp) => rp.permissionId));

    for (const key of Object.keys(matrix)) {
      const dataScope = matrix[key];
      const permissionId = permissionIdByKey.get(key);
      // permission chưa seed vào DB (quên chạy `pnpm db:seed` sau khi thêm permission mới) —
      // bỏ qua thay vì throw, vì hàm này chạy nền lúc khởi động, không được chặn cả API đứng lên.
      if (!permissionId || !dataScope || existingPermissionIds.has(permissionId)) continue;

      await tx.rolePermission.create({
        data: { tenantId, roleId: role.id, permissionId, dataScope, createdBy: actorId, updatedBy: actorId },
      });
      added.push(`${tenantId}/${role.name}/${key}`);
    }
  }

  return added;
}

/**
 * Chạy `syncRolePermissionsForTenant` cho MỌI tenant — gọi một lần lúc API khởi động
 * (`main.ts`), idempotent (an toàn gọi lại mỗi lần start). Không dùng cho tenant bị soft-delete.
 */
export async function syncRolePermissionsForAllTenants(
  prisma: PrismaClient,
  unitOfWork: UnitOfWorkService,
  actorId: string,
): Promise<string[]> {
  const tenants = await prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });

  const added: string[] = [];
  for (const tenant of tenants) {
    const result = await unitOfWork.runInTenantScope(tenant.id, (tx) =>
      syncRolePermissionsForTenant(tx, tenant.id, actorId),
    );
    added.push(...result);
  }
  return added;
}
