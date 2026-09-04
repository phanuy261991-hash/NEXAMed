import type { DataScope } from '@nexamed/shared';
import { useAuthStore } from './auth.store';

/**
 * Quyền THẬT của actor (2026-09-04, bug thu hồi quyền không có tác dụng — xem
 * `currentUserSchema.permissions`) — thay hoàn toàn cách cũ so khớp TÊN vai trò cứng
 * (`user.roles.includes('clinic_admin')`...) để ẩn/hiện menu/nút. Đặt ở `features/auth` (cạnh
 * `auth.store.ts`) với chủ đích dùng chung toàn app — mọi nơi cần ẩn/hiện theo quyền đều gọi qua
 * đây, không tự viết `user?.permissions[...]` rải rác.
 */

/** Scope thật actor đang giữ cho `<module>.<action>` — `undefined` nếu không có quyền (khớp "không có dòng nào" ở backend). */
export function useDataScope(module: string, action: string): DataScope | undefined {
  return useAuthStore((s) => s.user?.permissions[`${module}.${action}`]);
}

/** Có quyền `<module>.<action>` hay không, bất kể scope cụ thể (`personal` cũng tính) — dùng ẩn/hiện menu, nút. */
export function useHasPermission(module: string, action: string): boolean {
  return useDataScope(module, action) !== undefined;
}

/** Có ÍT NHẤT MỘT trong danh sách quyền — dùng cho khu vực gộp nhiều mục con khác quyền nhau (ví dụ nhóm "Quản trị"). */
export function useHasAnyPermission(pairs: ReadonlyArray<readonly [string, string]>): boolean {
  const permissions = useAuthStore((s) => s.user?.permissions);
  if (!permissions) return false;
  return pairs.some(([module, action]) => permissions[`${module}.${action}`] !== undefined);
}
