import { lazy } from 'react';
import { Flask } from '@phosphor-icons/react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { AppShell } from '../shared/layout/AppShell';
import { ComingSoonPage } from '../shared/ui/ComingSoonPage';
import { NotFoundPage } from './NotFoundPage';

/**
 * Code-splitting theo route (`.claude/docs/coding-standards.md` mục Hiệu suất) — trước đây toàn
 * bộ app nằm trong MỘT chunk, mọi vai trò tải hết mọi màn hình ngay lần vào đầu tiên (đo thật:
 * 802 kB). Nay mỗi trang nghiệp vụ là một chunk riêng, chỉ tải khi điều hướng tới.
 *
 * **Cố ý GIỮ EAGER** (không lazy): `LoginPage` (màn hình đầu tiên của mọi phiên — lazy sẽ thêm
 * một nhịp chờ ngay lúc mở app), `RequireAuth`/`AppShell`/`DashboardPage` (luôn cần ngay sau khi
 * đăng nhập), `ChangePasswordPage` (chặn điều hướng lúc buộc đổi mật khẩu lần đầu),
 * `NotFoundPage`/`ComingSoonPage` (rất nhỏ, tách ra không đáng).
 *
 * Component export dạng NAMED nên phải map `.then(m => ({ default: m.X }))` — `React.lazy` chỉ
 * nhận default export. Không đổi các file trang sang default export để giữ nguyên quy ước
 * named export của toàn bộ codebase.
 */
const DrugCatalogPane = lazy(() => import('../features/drug/DrugCatalogPane').then((m) => ({ default: m.DrugCatalogPane })));
const PatientListPage = lazy(() => import('../features/patient/PatientListPage').then((m) => ({ default: m.PatientListPage })));
const PatientNewPage = lazy(() => import('../features/patient/PatientNewPage').then((m) => ({ default: m.PatientNewPage })));
const PatientDetailPage = lazy(() => import('../features/patient/PatientDetailPage').then((m) => ({ default: m.PatientDetailPage })));
const AppointmentSchedulePage = lazy(() =>
  import('../features/appointment/AppointmentSchedulePage').then((m) => ({ default: m.AppointmentSchedulePage })),
);
const ReceptionListPage = lazy(() => import('../features/reception/ReceptionListPage').then((m) => ({ default: m.ReceptionListPage })));
const ReceptionRegisterPage = lazy(() =>
  import('../features/reception/ReceptionRegisterPage').then((m) => ({ default: m.ReceptionRegisterPage })),
);
const ReceptionDoctorQueuePage = lazy(() =>
  import('../features/reception/ReceptionDoctorQueuePage').then((m) => ({ default: m.ReceptionDoctorQueuePage })),
);
const EncounterConsultationPage = lazy(() =>
  import('../features/encounter/EncounterConsultationPage').then((m) => ({ default: m.EncounterConsultationPage })),
);
// Thu ngân cơ bản (Sprint 5/6, BIL-01→04).
const InvoiceListPage = lazy(() => import('../features/billing/InvoiceListPage').then((m) => ({ default: m.InvoiceListPage })));
const InvoiceDetailPage = lazy(() => import('../features/billing/InvoiceDetailPage').then((m) => ({ default: m.InvoiceDetailPage })));
// Nhóm Quản trị — chỉ `clinic_admin` dùng tới; lễ tân/điều dưỡng/bác sĩ không bao giờ tải các
// chunk này (gồm cả trang tra cứu ICD-10 và toàn bộ màn hình danh mục).
const CatalogAdminPage = lazy(() => import('../features/catalog/CatalogAdminPage').then((m) => ({ default: m.CatalogAdminPage })));
const CatalogClinicalPage = lazy(() =>
  import('../features/catalog-clinical/CatalogClinicalPage').then((m) => ({ default: m.CatalogClinicalPage })),
);
const RolePermissionPage = lazy(() => import('../features/role/RolePermissionPage').then((m) => ({ default: m.RolePermissionPage })));
const ClinicConfigPage = lazy(() => import('../features/clinic/ClinicConfigPage').then((m) => ({ default: m.ClinicConfigPage })));

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
      // Thu ngân cơ bản (Sprint 5/6) — không có mục sidebar riêng cho chi tiết (cùng cách
      // patient/appointment/encounter detail không có mục sidebar riêng).
      { path: 'billing', element: <InvoiceListPage /> },
      { path: 'billing/:encounterId', element: <InvoiceDetailPage /> },
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
      // Sprint 4, S4-03 — trang "Danh mục thuốc" thật, thay ComingSoonPage cũ. Chỉ thuốc (v1 không
      // quản lý vật tư y tế/kho — xem docs/product/future-modules-reference.md mục 2.2.1).
      { path: 'admin/catalog-pharmacy', element: <DrugCatalogPane /> },
      { path: 'admin/system-config', element: <ClinicConfigPage /> },
      // Bắt mọi đường dẫn con không khớp — thay trang trắng 404 mặc định của react-router bằng
      // trang thương hiệu (docs/DECISIONS.md #048). Route `*` ở đây đã phủ hầu hết trường hợp
      // thật (`RequireAuth` chặn lúc chưa đăng nhập, chuyển `/login` TRƯỚC khi Outlet render tới
      // route này — không cần thêm `*` cấp gốc ngoài `AppShell`, sẽ không bao giờ khớp tới).
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);