import { useEffect, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { AuditLogPage } from './AuditLogPage';
import { PlatformLoginPage } from './PlatformLoginPage';
import { PlatformShell } from './PlatformShell';
import { TenantCreatePage } from './TenantCreatePage';
import { TenantDetailPage } from './TenantDetailPage';
import { TenantListPage } from './TenantListPage';
import { configurePlatformApi } from './platform.api';
import { usePlatformSession } from './platform.store';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function RequireOperator() {
  const operator = usePlatformSession((s) => s.operator);
  if (!operator) return <Navigate to="/login" replace />;
  return (
    <PlatformShell>
      <Outlet />
    </PlatformShell>
  );
}

function LoginRoute() {
  const operator = usePlatformSession((s) => s.operator);
  if (operator) return <Navigate to="/" replace />;
  return <PlatformLoginPage />;
}

/**
 * Khu quản trị nền tảng SaaS (docs/DECISIONS.md #237) — một ứng dụng web riêng bên trong cùng gói, chỉ được nạp ở TÊN MIỀN QUẢN TRỊ (`admin.<tên miền gốc>`, xem `app/main.tsx`). Không dùng chung
 * phiên, router hay client API với giao diện phòng khám; chỉ hiển thị số đếm vận hành, không có dữ liệu bệnh nhân.
 */
export function PlatformApp({ apiBaseUrl }: { apiBaseUrl: string }) {
  const clear = usePlatformSession((s) => s.clear);

  useEffect(() => {
    configurePlatformApi(apiBaseUrl, { onUnauthorized: clear });
  }, [apiBaseUrl, clear]);
  // Cấu hình phải có TRƯỚC lần gọi API đầu tiên của trang con (effect của con chạy trước effect của cha) — gọi đồng bộ thêm một lần ở đây.
  configurePlatformApi(apiBaseUrl, { onUnauthorized: clear });

  const router = useMemo(
    () =>
      createBrowserRouter([
        { path: '/login', element: <LoginRoute /> },
        {
          element: <RequireOperator />,
          children: [
            { index: true, element: <TenantListPage /> },
            { path: 'tenants/new', element: <TenantCreatePage /> },
            { path: 'tenants/:id', element: <TenantDetailPage /> },
            { path: 'audit', element: <AuditLogPage /> },
          ],
        },
        { path: '*', element: <Navigate to="/" replace /> },
      ]),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
