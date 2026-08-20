import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './auth.store';

const CHANGE_PASSWORD_PATH = '/change-password';

/**
 * Bọc route cần đăng nhập — `AppBootstrap` chạy song song để xác định `status` lúc app khởi động.
 * Mở rộng ADM-01: `user.mustChangePassword===true` chặn điều hướng tới MỌI route khác (kể cả
 * `/` mặc định sau login) cho tới khi đổi xong — trừ chính `/change-password` (tránh vòng lặp
 * redirect). Áp dụng ở đây (không phải `LoginPage`) để bắt được cả trường hợp khôi phục phiên lúc
 * F5 (`AppBootstrap` → `/auth/me`), không chỉ lúc vừa đăng nhập.
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

  if (user?.mustChangePassword === true && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }

  return <>{children}</>;
}
