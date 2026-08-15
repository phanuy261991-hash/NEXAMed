import { Flask, GraduationCap, Pill, Users } from '@phosphor-icons/react';
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
import { ComingSoonPage } from '../shared/ui/ComingSoonPage';

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
      {
        path: 'admin/catalog-organization',
        element: (
          <ComingSoonPage
            pageTitle="Danh mục Tổ chức và Nhân sự"
            icon={Users}
            description="Khoa/phòng, chức danh, nhân sự phòng khám sẽ quản lý được ở đây khi module tương ứng ra đời."
          />
        ),
      },
      {
        path: 'admin/catalog-clinical',
        element: (
          <ComingSoonPage
            pageTitle="Danh mục Chuyên môn"
            icon={GraduationCap}
            description="Danh mục chuyên môn khám chữa bệnh sẽ quản lý được ở đây khi module tương ứng ra đời."
          />
        ),
      },
      {
        path: 'admin/catalog-paraclinical',
        element: (
          <ComingSoonPage
            pageTitle="Danh mục Cận lâm sàng"
            icon={Flask}
            description="Danh mục xét nghiệm, chẩn đoán hình ảnh sẽ quản lý được ở đây khi module tương ứng ra đời."
          />
        ),
      },
      {
        path: 'admin/catalog-pharmacy',
        element: (
          <ComingSoonPage
            pageTitle="Danh mục Dược và Vật tư"
            icon={Pill}
            description="Danh mục thuốc, vật tư y tế sẽ quản lý được ở đây khi module tương ứng ra đời."
          />
        ),
      },
      { path: 'admin/system-config', element: <ClinicConfigPage /> },
    ],
  },
]);
