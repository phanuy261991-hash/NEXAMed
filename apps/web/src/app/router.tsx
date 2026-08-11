import { createBrowserRouter, Outlet } from 'react-router-dom';
import { AdminPage } from '../features/admin/AdminPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { AppShell } from '../shared/layout/AppShell';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell>
          <Outlet />
        </AppShell>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'admin', element: <AdminPage /> },
    ],
  },
]);
