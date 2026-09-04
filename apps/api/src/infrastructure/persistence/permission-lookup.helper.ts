import type { Prisma } from '@prisma/client';
import { maxDataScope, permissionKey } from '@nexamed/core';
import type { DataScope } from '@nexamed/shared';

/**
 * Đọc `data_scope` mà một user có cho một permission `<module>.<action>`, gộp qua toàn bộ vai
 * trò user đang giữ (một user có thể nhiều vai trò — lấy `maxDataScope` ở tầng gọi). Đặt ở
 * `infrastructure/persistence` như `audit-log.helper.ts`: hạ tầng cross-cutting mọi module domain
 * cần gọi qua `PermissionGuard`, không thuộc riêng module `iam`.
 *
 * `deletedAt: null` BẮT BUỘC ở cả `rolePermission` lẫn `userRoles` lồng bên trong — thiếu 1 trong
 * 2 (bug thật phát hiện 2026-09-04) làm quyền đã thu hồi qua "Vai trò & Phân quyền"
 * (`RolePermissionRepository.replaceMatrix`, soft-delete) hoặc vai trò đã gỡ khỏi tài khoản
 * (`UserAccountRepository.softDeleteAllUserRoles`) vẫn còn hiệu lực vĩnh viễn — bảng phân quyền
 * chỉ CẤP thêm được chứ không THU HỒI được, làm mất tác dụng của toàn bộ tính năng ADM-07.
 */
export async function findScopesForUserPermission(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  module: string,
  action: string,
): Promise<DataScope[]> {
  const rows = await tx.rolePermission.findMany({
    where: {
      tenantId,
      deletedAt: null,
      permission: { module, action },
      role: { deletedAt: null, userRoles: { some: { tenantId, userId, deletedAt: null } } },
    },
    select: { dataScope: true },
  });
  return rows.map((r) => r.dataScope);
}

/**
 * TOÀN BỘ quyền thật của một user (khoá `"<module>.<action>"` → scope rộng nhất), một truy vấn
 * duy nhất — phục vụ `GET /auth/me`/login để web ẩn/hiện menu-nút theo ĐÚNG quyền được cấp thay
 * vì so khớp tên vai trò cứng (bug thật 2026-09-04, xem `currentUserSchema.permissions`).
 *
 * Dùng CHUNG đúng điều kiện lọc với `findScopesForUserPermission` ở trên (kể cả `deletedAt: null`
 * ở cả 3 tầng) — bắt buộc phải khớp tuyệt đối, nếu không giao diện lại nói khác backend đúng
 * kiểu lỗi đang sửa. Quyền `none` không bao giờ có dòng trong `role_permission` (thu hồi =
 * soft-delete, xem `RolePermissionRepository.replaceMatrix`) nên kết quả chỉ chứa quyền thật sự
 * được cấp.
 */
export async function findAllPermissionsForUser(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
): Promise<Record<string, DataScope>> {
  const rows = await tx.rolePermission.findMany({
    where: {
      tenantId,
      deletedAt: null,
      role: { deletedAt: null, userRoles: { some: { tenantId, userId, deletedAt: null } } },
    },
    select: { dataScope: true, permission: { select: { module: true, action: true } } },
  });

  const scopesByKey = new Map<string, DataScope[]>();
  for (const row of rows) {
    const key = permissionKey(row.permission);
    const existing = scopesByKey.get(key);
    if (existing) {
      existing.push(row.dataScope);
    } else {
      scopesByKey.set(key, [row.dataScope]);
    }
  }

  const result: Record<string, DataScope> = {};
  for (const [key, scopes] of scopesByKey) {
    const scope = maxDataScope(scopes);
    if (scope !== 'none') {
      result[key] = scope;
    }
  }
  return result;
}
