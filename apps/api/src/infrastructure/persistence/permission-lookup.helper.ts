import type { Prisma } from '@prisma/client';
import type { DataScope } from '@nexamed/shared';

/**
 * Đọc `data_scope` mà một user có cho một permission `<module>.<action>`, gộp qua toàn bộ vai
 * trò user đang giữ (một user có thể nhiều vai trò — lấy `maxDataScope` ở tầng gọi). Đặt ở
 * `infrastructure/persistence` như `audit-log.helper.ts`: hạ tầng cross-cutting mọi module domain
 * cần gọi qua `PermissionGuard`, không thuộc riêng module `iam`.
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
      permission: { module, action },
      role: { userRoles: { some: { tenantId, userId } } },
    },
    select: { dataScope: true },
  });
  return rows.map((r) => r.dataScope);
}
