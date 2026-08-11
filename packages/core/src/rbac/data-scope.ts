import type { DataScope } from '@nexamed/shared';

/**
 * Thứ hạng `data_scope` — dùng để gộp nhiều dòng `role_permission` (một user có thể có nhiều
 * vai trò) thành một quyết định duy nhất: lấy scope rộng nhất trong số các vai trò đang có. Xem
 * .claude/docs/security-audit.md mục Data Scope.
 */
const SCOPE_RANK: Record<DataScope, number> = { none: 0, personal: 1, department: 2, global: 3 };

/** Không có dòng nào (mảng rỗng) coi như `'none'` — không tìm thấy quyền nghĩa là không có quyền. */
export function maxDataScope(scopes: readonly DataScope[]): DataScope {
  let max: DataScope = 'none';
  for (const scope of scopes) {
    if (SCOPE_RANK[scope] > SCOPE_RANK[max]) {
      max = scope;
    }
  }
  return max;
}
