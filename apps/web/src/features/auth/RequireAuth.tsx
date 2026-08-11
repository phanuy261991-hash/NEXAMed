import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from './auth.store';

/** Bọc route cần đăng nhập — `AppBootstrap` chạy song song để xác định `status` lúc app khởi động. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);

  if (status === 'idle') {
    return <div className="flex min-h-dvh items-center justify-center bg-slate-50 text-sm text-slate-500">Đang tải...</div>;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
