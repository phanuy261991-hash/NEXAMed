import { Flask, Pill } from '@phosphor-icons/react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AppointmentSchedulePage } from '../features/appointment/AppointmentSchedulePage';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { CatalogAdminPage } from '../features/catalog/CatalogAdminPage';
import { CatalogClinicalPage } from '../features/catalog-clinical/CatalogClinicalPage';
import { ClinicConfigPage } from '../features/clinic/ClinicConfigPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { EncounterConsultationPage } from '../features/encounter/EncounterConsultationPage';
import { PatientDetailPage } from '../features/patient/PatientDetailPage';
import { PatientListPage } from '../features/patient/PatientListPage';
import { PatientNewPage } from '../features/patient/PatientNewPage';
import { ReceptionDoctorQueuePage } from '../features/reception/ReceptionDoctorQueuePage';
import { ReceptionListPage } from '../features/reception/ReceptionListPage';
import { ReceptionRegisterPage } from '../features/reception/ReceptionRegisterPage';
import { RolePermissionPage } from '../features/role/RolePermissionPage';
import { AppShell } from '../shared/layout/AppShell';
import { ComingSoonPage } from '../shared/ui/ComingSoonPage';
import { NotFoundPage } from './NotFoundPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Mở rộng ADM-01 — bắt buộc đổi mật khẩu lần đầu. Đứng NGOÀI AppShell (không sidebar), nhưng
  // vẫn bọc RequireAuth (cần đăng nhập để gọi POST /auth/change-password).
  {
    path: '/change-password',
    element: (
      <RequireAuth>
        <ChangePasswordPage />
      </RequireAuth>
    ),
  },
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
      // Màn hình khám bệnh (S3-06/07) — vào từ "Hàng đợi khám", không có mục sidebar riêng (cùng
      // cách patient/appointment detail không có mục sidebar riêng).
      { path: 'encounters/:id', element: <EncounterConsultationPage /> },
      // Trình duyệt hay gợi ý gõ tắt "/admin" (rút gọn từ lịch sử "/admin/catalog") — chưa từng
      // là route thật, trước đây báo lỗi 404 mặc định của react-router (docs/DECISIONS.md #048).
      { path: 'admin', element: <Navigate to="/admin/catalog" replace /> },
      { path: 'admin/catalog', element: <CatalogAdminPage /> },
      // ADM-07 (Vai trò & Phân quyền) + mở rộng ADM-01 (Quản lý tài khoản, danh mục nhân sự).
      { path: 'admin/catalog-organization', element: <RolePermissionPage /> },
      // S3-01 (mở khoá một phần) — trang tra cứu ICD-10 thật, thay ComingSoonPage cũ.
      { path: 'admin/catalog-clinical', element: <CatalogClinicalPage /> },
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
      // Bắt mọi đường dẫn con không khớp — thay trang trắng 404 mặc định của react-router bằng
      // trang thương hiệu (docs/DECISIONS.md #048). Route `*` ở đây đã phủ hầu hết trường hợp
      // thật (`RequireAuth` chặn lúc chưa đăng nhập, chuyển `/login` TRƯỚC khi Outlet render tới
      // route này — không cần thêm `*` cấp gốc ngoài `AppShell`, sẽ không bao giờ khớp tới).
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);