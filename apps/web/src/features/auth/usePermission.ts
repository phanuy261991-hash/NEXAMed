import type { DataScope } from '@nexamed/shared';
import { useAuthStore } from './auth.store';
import { isScopeAtLeast } from './scope-rank';

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

/**
 * Có quyền `<module>.<action>` với phạm vi ÍT NHẤT `minScope` hay không — dùng cho trang/mục menu chỉ dành cho người xem được dữ liệu của người khác
 * (ví dụ danh sách phiếu chốt ca: phạm vi `personal` có quyền nhưng máy chủ từ chối danh sách, nên không được cho vào trang rồi mới báo lỗi tải).
 */
export function useHasPermissionAtLeast(module: string, action: string, minScope: Exclude<DataScope, 'none'>): boolean {
  const scope = useDataScope(module, action);
  return scope !== undefined && isScopeAtLeast(scope, minScope);
}

/**
 * Giữ lại các mục có `permission` mà actor đang giữ (mục không khai báo `permission` luôn giữ). Dùng cho thanh pill/tab của trang gộp nhiều màn hình khác quyền nhau:
 * pill nào cần API mà actor không có quyền thì KHÔNG hiện, tránh mở ra rồi mới báo "Không tải được" (403).
 */
export function useFilterByPermission<T extends { permission?: readonly [string, string] }>(items: readonly T[]): T[] {
  const permissions = useAuthStore((s) => s.user?.permissions);
  return items.filter((item) => item.permission === undefined || permissions?.[`${item.permission[0]}.${item.permission[1]}`] !== undefined);
}

/** Có ÍT NHẤT MỘT trong danh sách quyền — dùng cho khu vực gộp nhiều mục con khác quyền nhau (ví dụ nhóm "Quản trị"). */
export function useHasAnyPermission(pairs: ReadonlyArray<readonly [string, string]>): boolean {
  const permissions = useAuthStore((s) => s.user?.permissions);
  if (!permissions) return false;
  return pairs.some(([module, action]) => permissions[`${module}.${action}`] !== undefined);
}

/** Khoa/Phòng của actor đang đăng nhập (`user_account.department_id`, #063) — `null` nếu chưa gán.
 * Kho Thuốc GĐ4 (docs/DECISIONS.md #170) thêm — dùng để tự lọc dropdown kho theo Khoa khi
 * `useDataScope(module, action) === 'department'` (ví dụ form tạo phiếu kiểm kê). */
export function useActorDepartmentId(): string | null {
  return useAuthStore((s) => s.user?.departmentId ?? null);
}
