import type { ReactNode } from 'react';
import { PermissionDeniedPage } from '../../shared/ui/PermissionDeniedPage';
import { DOCTOR_QUEUE_ROLES } from './workflow-roles';
import { useAuthStore } from './auth.store';
import { useHasAnyPermission, useHasPermission } from './usePermission';

/**
 * Chặn ở tầng ROUTE, không chỉ ẩn menu (2026-09-04) — trước đó `Sidebar.tsx` ẩn mục nhưng vào
 * thẳng URL vẫn tải được trang rồi mới 403 rải rác từng API call (bug thật, xem
 * `docs/DECISIONS.md`). Đặt cạnh `RequireAuth.tsx` — cùng vai trò "route guard", chỉ khác điều
 * kiện (đăng nhập vs. quyền cụ thể).
 */
export function RequirePermissionRoute({ module, action, children }: { module: string; action: string; children: ReactNode }) {
  const allowed = useHasPermission(module, action);
  return allowed ? <>{children}</> : <PermissionDeniedPage />;
}

/** Như trên nhưng cho phép ÍT NHẤT MỘT trong nhiều quyền — dùng cho route gộp nhiều tính năng con khác quyền nhau. */
export function RequireAnyPermissionRoute({ permissions, children }: { permissions: ReadonlyArray<readonly [string, string]>; children: ReactNode }) {
  const allowed = useHasAnyPermission(permissions);
  return allowed ? <>{children}</> : <PermissionDeniedPage />;
}

/** "Hàng đợi khám" — chặn theo TÊN VAI TRÒ (quyết định workflow đã chốt, không phải quyền cụ thể), xem `workflow-roles.ts`. */
export function RequireDoctorQueueRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const allowed = user?.roles.some((role) => DOCTOR_QUEUE_ROLES.includes(role)) ?? false;
  return allowed ? <>{children}</> : <PermissionDeniedPage />;
}
