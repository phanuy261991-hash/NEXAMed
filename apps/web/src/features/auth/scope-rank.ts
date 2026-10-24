import type { DataScope } from '@nexamed/shared';

/** Thứ hạng phạm vi dữ liệu. Chỉ KIỂU được import từ `@nexamed/shared` ở web (bản chạy là CommonJS), nên thứ hạng viết lại ở đây — khớp `SCOPE_RANK` ở `packages/core/src/rbac/data-scope.ts`. */
const SCOPE_RANK: Record<DataScope, number> = { none: 0, personal: 1, department: 2, global: 3 };

/** `scope` có ít nhất rộng bằng `min` không; `undefined` (không có quyền) coi như `none`. Logic thuần để test được. */
export function isScopeAtLeast(scope: DataScope | undefined, min: DataScope): boolean {
  return SCOPE_RANK[scope ?? 'none'] >= SCOPE_RANK[min];
}
