import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, permissionKey } from '@nexamed/core';
import { USER_ROLES, type DataScope, type UserRole } from '@nexamed/shared';
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

    const candidates: { key: string; permissionId: string; dataScope: DataScope }[] = [];
    for (const key of Object.keys(matrix)) {
      const dataScope = matrix[key];
      const permissionId = permissionIdByKey.get(key);
      // permission chưa seed vào DB (quên chạy `pnpm db:seed` sau khi thêm permission mới) —
      // bỏ qua thay vì throw, vì hàm này chạy nền lúc khởi động, không được chặn cả API đứng lên.
      if (!permissionId || !dataScope || existingPermissionIds.has(permissionId)) continue;
      candidates.push({ key, permissionId, dataScope });
    }
    if (candidates.length === 0) continue;

    // `createMany({ skipDuplicates: true })` thay vì `create()` từng dòng: đọc-rồi-ghi
    // (existingPermissionIds ở trên, insert ở đây) không atomic — nếu một tiến trình khác (API
    // instance khác cùng khởi động, hoặc trong test, một spec khác đang seed cùng lúc trong DB
    // test dùng chung) đã chèn đúng dòng này ở khoảng giữa, `create()` từng dòng sẽ ném P2002 VÀ
    // (khác biệt quan trọng) làm ABORT CẢ TRANSACTION Postgres đang mở — mọi câu lệnh tiếp theo
    // trong cùng transaction (kể cả try/catch ở tầng JS) đều lỗi 25P02 cho tới khi rollback, dù đã
    // "bắt" được lỗi ném ra. `createMany` với `skipDuplicates` xử lý xung đột bằng `ON CONFLICT DO
    // NOTHING` ở tầng SQL — không bao giờ ném lỗi, không bao giờ làm abort transaction.
    await tx.rolePermission.createMany({
      data: candidates.map((c) => ({
        tenantId,
        roleId: role.id,
        permissionId: c.permissionId,
        dataScope: c.dataScope,
        createdBy: actorId,
        updatedBy: actorId,
      })),
      skipDuplicates: true,
    });
    for (const c of candidates) {
      added.push(`${tenantId}/${role.name}/${c.key}`);
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
