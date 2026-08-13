import { createBrowserRouter, Outlet } from 'react-router-dom';
import { AppointmentSchedulePage } from '../features/appointment/AppointmentSchedulePage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { CatalogAdminPage } from '../features/catalog/CatalogAdminPage';
import { ClinicConfigPage } from '../features/clinic/ClinicConfigPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { PatientDetailPage } from '../features/patient/PatientDetailPage';
import { PatientListPage } from '../features/patient/PatientListPage';
import { PatientNewPage } from '../features/patient/PatientNewPage';
import { ReceptionDoctorQueuePage } from '../features/reception/ReceptionDoctorQueuePage';
import { ReceptionListPage } from '../features/reception/ReceptionListPage';
import { ReceptionRegisterPage } from '../features/reception/ReceptionRegisterPage';
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
      { path: 'appointments', element: <AppointmentSchedulePage /> },
      { path: 'reception', element: <ReceptionListPage /> },
      { path: 'reception/new', element: <ReceptionRegisterPage /> },
      { path: 'reception/doctor-queue', element: <ReceptionDoctorQueuePage /> },
      { path: 'admin/catalog', element: <CatalogAdminPage /> },
      { path: 'admin/system-config', element: <ClinicConfigPage /> },
    ],
  },
]);
