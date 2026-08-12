import { createBrowserRouter, Outlet } from 'react-router-dom';
import { AdminPage } from '../features/admin/AdminPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PatientDetailPage } from '../features/patient/PatientDetailPage';
import { PatientListPage } from '../features/patient/PatientListPage';
import { PatientNewPage } from '../features/patient/PatientNewPage';
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
      { path: 'patients', element: <PatientListPage /> },
      { path: 'patients/new', element: <PatientNewPage /> },
      { path: 'patients/:id', element: <PatientDetailPage /> },
      { path: 'admin', element: <AdminPage /> },
    ],
  },
]);
