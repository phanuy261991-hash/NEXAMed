import type { Prisma } from '@prisma/client';

export interface AuditLogEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson?: Prisma.InputJsonValue;
  afterJson?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Ghi thẳng `audit_log` trong transaction hiện tại — dùng cho thao tác GHI (đăng nhập/đăng
 * xuất, break-glass, và mọi thao tác ghi nghiệp vụ từ S2 trở đi). Đặt ở
 * `infrastructure/persistence` (cạnh `PrismaService`/`UnitOfWorkService`), không phải trong một
 * module domain cụ thể, vì đây là hạ tầng cross-cutting mọi module đều cần gọi — để trong
 * `modules/iam/` sẽ buộc module khác import xuyên domain `iam`, sát ranh giới cấm trong
 * .claude/docs/coding-standards.md ("Module không import trực tiếp module khác").
 *
 * Thao tác XEM (GET thuần, không có transaction nghiệp vụ nào để "ghi cùng") dùng cơ chế khác —
 * xem `apps/api/src/common/audit-view.interceptor.ts` và .claude/docs/security-audit.md mục
 * Audit log.
 */
export function writeAuditLog(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entry: AuditLogEntry,
): Promise<{ id: string }> {
  return tx.auditLog.create({
    data: {
      tenantId,
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeJson: entry.beforeJson,
      afterJson: entry.afterJson,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
    select: { id: true },
  });
}
