import { SetMetadata } from '@nestjs/common';

export const PERMISSION_METADATA_KEY = 'permission';

export interface PermissionMetadata {
  module: string;
  action: string;
  /** Tên route param chứa entityId — chỉ cần khi muốn cho phép break-glass cho route này. */
  entityIdParam?: string;
}

/**
 * Đánh dấu route cần permission `<module>.<action>` (khớp `packages/core/src/rbac/permissions.ts`)
 * — dùng cùng `PermissionGuard` (đọc `role_permission` theo `data_scope`, xem .claude/docs/
 * security-audit.md). `entityIdParam` chỉ khai báo cho route thao tác một bản ghi cụ thể
 * (`@Get(':id')`, `@Patch(':id')`) — route list/create không có entityId nên không thể
 * break-glass, bị chặn `none` là chặn hẳn.
 */
export const RequirePermission = (module: string, action: string, options?: { entityIdParam?: string }) =>
  SetMetadata(PERMISSION_METADATA_KEY, {
    module,
    action,
    entityIdParam: options?.entityIdParam,
  } satisfies PermissionMetadata);
