import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getAuthRedirect } from './auth-redirect';
import { useAuthStore } from './auth.store';

/**
 * Bọc route cần đăng nhập — `AppBootstrap` chạy song song để xác định `status` lúc app khởi động.
 * Mở rộng ADM-01: `user.mustChangePassword===true` chặn điều hướng tới MỌI route khác (kể cả
 * `/` mặc định sau login) cho tới khi đổi xong — trừ chính `/change-password` (tránh vòng lặp
 * redirect). Áp dụng ở đây (không phải `LoginPage`) để bắt được cả trường hợp khôi phục phiên lúc
 * F5 (`AppBootstrap` → `/auth/me`), không chỉ lúc vừa đăng nhập.
 * Tầng chi nhánh (docs/DECISIONS.md #231): tài khoản được gán từ 2 chi nhánh mà phiên chưa chọn nơi làm việc (`currentBranchId===null`) bị chuyển tới
 * `/choose-branch` — cùng khuôn `mustChangePassword`, đứng SAU kiểm tra đổi mật khẩu. Quy tắc nằm ở `getAuthRedirect` (hàm thuần, có test).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (status === 'idle') {
    return <div className="flex min-h-dvh items-center justify-center bg-slate-50 text-sm text-slate-500">Đang tải...</div>;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  const redirectTo = getAuthRedirect(user, location.pathname);
  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
