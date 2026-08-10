import { SetMetadata } from '@nestjs/common';

export const AUDIT_VIEW_METADATA_KEY = 'audit-view';

export interface AuditViewMetadata {
  entityType: string;
  paramName: string;
}

/**
 * Đánh dấu route GET cần ghi audit "xem" (xem .claude/docs/security-audit.md mục Audit log).
 * `paramName` mặc định `'id'` — tên route param chứa entityId (`@Get(':id')` → `req.params.id`).
 * Dùng cùng `AuditViewInterceptor` (`apps/api/src/common/audit-view.interceptor.ts`).
 */
export const AuditView = (entityType: string, options?: { paramName?: string }) =>
  SetMetadata(AUDIT_VIEW_METADATA_KEY, { entityType, paramName: options?.paramName ?? 'id' } satisfies AuditViewMetadata);
