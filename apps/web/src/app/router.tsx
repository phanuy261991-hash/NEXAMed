import { lazy } from 'react';
import { Flask } from '@phosphor-icons/react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { RequireAnyPermissionRoute, RequireDoctorQueueRoute, RequirePermissionRoute } from '../features/auth/RequirePermissionRoute';
import { ADMIN_ANY_PERMISSIONS, ADMIN_ORG_PERMISSIONS, DRUG_MANAGE_PERMISSIONS } from '../features/auth/admin-permissions';
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
const PharmacyCatalogPage = lazy(() => import('../features/drug/PharmacyCatalogPage').then((m) => ({ default: m.PharmacyCatalogPage })));
// "Danh mục kho" — tách khỏi "Thuốc & Vật tư" thành trang riêng (docs/DECISIONS.md #157).
const WarehouseCatalogPage = lazy(() => import('../features/drug/WarehouseCatalogPage').then((m) => ({ default: m.WarehouseCatalogPage })));
// "Quản lý nhà cung cấp" — tách khỏi "Danh mục Thuốc và Vật Tư" thành trang/nhóm menu riêng.
const SupplierManagementPage = lazy(() =>
  import('../features/drug/SupplierManagementPage').then((m) => ({ default: m.SupplierManagementPage })),
);
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
const CashierShiftListPage = lazy(() =>
  import('../features/cashier-shift/CashierShiftListPage').then((m) => ({ default: m.CashierShiftListPage })),
);
// Sổ quỹ & Thu chi (GĐ1, ngoài kế hoạch, 2026-09-05).
const CashVoucherListPage = lazy(() => import('../features/cash-book/CashVoucherListPage').then((m) => ({ default: m.CashVoucherListPage })));
// Sổ quỹ & Thu chi Giai đoạn 2 (Sổ quỹ + Báo cáo dòng tiền).
const CashBookPage = lazy(() => import('../features/cash-book/CashBookPage').then((m) => ({ default: m.CashBookPage })));
const CashFlowReportPage = lazy(() => import('../features/cash-book/CashFlowReportPage').then((m) => ({ default: m.CashFlowReportPage })));
const WalletListPage = lazy(() => import('../features/patient-wallet/WalletListPage').then((m) => ({ default: m.WalletListPage })));
// Kho Thuốc GĐ2 — "Phiếu nhập kho"/"Tồn kho" (docs/DECISIONS.md #146, kế hoạch precious-humming-goblet.md).
const StockReceiptListPage = lazy(() => import('../features/inventory/StockReceiptListPage').then((m) => ({ default: m.StockReceiptListPage })));
const StockReceiptFormPage = lazy(() => import('../features/inventory/StockReceiptFormPage').then((m) => ({ default: m.StockReceiptFormPage })));
const StockBalancePage = lazy(() => import('../features/inventory/StockBalancePage').then((m) => ({ default: m.StockBalancePage })));
// Kho Thuốc GĐ3 — "Phát thuốc" (docs/DECISIONS.md #163, kế hoạch fluttering-scribbling-liskov.md).
const DispenseQueuePage = lazy(() => import('../features/inventory/DispenseQueuePage').then((m) => ({ default: m.DispenseQueuePage })));
// "Phiếu xuất kho" — rà soát lỗ hổng quy trình 22/09/2026 (docs/DECISIONS.md #171): liệt kê MỌI
// phiếu xuất (phát thuốc + xuất cân bằng kiểm kê), khác "Phát thuốc" chỉ phục vụ luồng dược sĩ.
const StockIssueListPage = lazy(() => import('../features/inventory/StockIssueListPage').then((m) => ({ default: m.StockIssueListPage })));
// Kho Thuốc GĐ4, phần "Kiểm kê" (docs/DECISIONS.md #170, kế hoạch bright-bubbling-axolotl.md).
const StockCountListPage = lazy(() => import('../features/inventory/StockCountListPage').then((m) => ({ default: m.StockCountListPage })));
const StockCountFormPage = lazy(() => import('../features/inventory/StockCountFormPage').then((m) => ({ default: m.StockCountFormPage })));
// Kho Thuốc GĐ4, phần "Điều chuyển kho" (docs/DECISIONS.md #170, kế hoạch bright-bubbling-axolotl.md).
const StockTransferListPage = lazy(() => import('../features/inventory/StockTransferListPage').then((m) => ({ default: m.StockTransferListPage })));
const StockTransferFormPage = lazy(() => import('../features/inventory/StockTransferFormPage').then((m) => ({ default: m.StockTransferFormPage })));
// Nhóm Quản trị — chỉ `clinic_admin` dùng tới; lễ tân/điều dưỡng/bác sĩ không bao giờ tải các
// chunk này (gồm cả trang tra cứu ICD-10 và toàn bộ màn hình danh mục).
const CatalogAdminPage = lazy(() => import('../features/catalog/CatalogAdminPage').then((m) => ({ default: m.CatalogAdminPage })));
const CatalogClinicalPage = lazy(() =>
  import('../features/catalog-clinical/CatalogClinicalPage').then((m) => ({ default: m.CatalogClinicalPage })),
);
const RolePermissionPage = lazy(() => import('../features/role/RolePermissionPage').then((m) => ({ default: m.RolePermissionPage })));
const ClinicConfigPage = lazy(() => import('../features/clinic/ClinicConfigPage').then((m) => ({ default: m.ClinicConfigPage })));
const ActivityLogPage = lazy(() => import('../features/audit/ActivityLogPage').then((m) => ({ default: m.ActivityLogPage })));
// "Đăng ký ca làm việc" (Giai đoạn 2 #101).
const MyWorkSchedulePage = lazy(() =>
  import('../features/work-shift-assignment/MyWorkSchedulePage').then((m) => ({ default: m.MyWorkSchedulePage })),
);
const StaffWorkSchedulePage = lazy(() =>
  import('../features/work-shift-assignment/StaffWorkSchedulePage').then((m) => ({ default: m.StaffWorkSchedulePage })),
);

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
      { path: 'patients', element: <RequirePermissionRoute module="patient" action="read"><PatientListPage /></RequirePermissionRoute> },
      { path: 'patients/new', element: <RequirePermissionRoute module="patient" action="create"><PatientNewPage /></RequirePermissionRoute> },
      { path: 'patients/:id', element: <RequirePermissionRoute module="patient" action="read"><PatientDetailPage /></RequirePermissionRoute> },
      { path: 'appointments', element: <RequirePermissionRoute module="appointment" action="read"><AppointmentSchedulePage /></RequirePermissionRoute> },
      { path: 'reception', element: <RequirePermissionRoute module="encounter" action="read"><ReceptionListPage /></RequirePermissionRoute> },
      { path: 'reception/new', element: <RequirePermissionRoute module="encounter" action="create"><ReceptionRegisterPage /></RequirePermissionRoute> },
      // "Hàng đợi khám" — chặn theo TÊN VAI TRÒ (quyết định workflow đã chốt, không phải quyền cụ
      // thể — điều dưỡng/lễ tân cũng có encounter.read nhưng cố tình không cho vào màn này), xem
      // `features/auth/workflow-roles.ts`.
      { path: 'reception/doctor-queue', element: <RequireDoctorQueueRoute><ReceptionDoctorQueuePage /></RequireDoctorQueueRoute> },
      // Màn hình khám bệnh (S3-06/07) — vào từ "Hàng đợi khám", không có mục sidebar riêng (cùng
      // cách patient/appointment detail không có mục sidebar riêng).
      { path: 'encounters/:id', element: <RequirePermissionRoute module="encounter" action="read"><EncounterConsultationPage /></RequirePermissionRoute> },
      // Thu ngân cơ bản (Sprint 5/6) — không có mục sidebar riêng cho chi tiết (cùng cách
      // patient/appointment/encounter detail không có mục sidebar riêng).
      { path: 'billing', element: <RequirePermissionRoute module="invoice" action="read"><InvoiceListPage /></RequirePermissionRoute> },
      { path: 'billing/cashier-shifts', element: <RequirePermissionRoute module="cashier_shift" action="read"><CashierShiftListPage /></RequirePermissionRoute> },
      { path: 'billing/:encounterId', element: <RequirePermissionRoute module="invoice" action="read"><InvoiceDetailPage /></RequirePermissionRoute> },
      // Sổ quỹ & Thu chi (GĐ1) — không có mục sidebar riêng cho chi tiết (mở bằng dialog tại chỗ).
      { path: 'cash-book/vouchers', element: <RequirePermissionRoute module="cash_voucher" action="read"><CashVoucherListPage /></RequirePermissionRoute> },
      // Sổ quỹ & Thu chi Giai đoạn 2 — Sổ quỹ (cash_voucher.read, cùng quyền Phiếu thu/chi) + Báo
      // cáo dòng tiền (cash_voucher.report, CHỈ clinic_admin).
      { path: 'cash-book/ledger', element: <RequirePermissionRoute module="cash_voucher" action="read"><CashBookPage /></RequirePermissionRoute> },
      { path: 'cash-book/report', element: <RequirePermissionRoute module="cash_voucher" action="report"><CashFlowReportPage /></RequirePermissionRoute> },
      { path: 'cash-book/wallets', element: <RequirePermissionRoute module="patient_wallet" action="settle"><WalletListPage /></RequirePermissionRoute> },

      { path: 'inventory/receipts', element: <RequirePermissionRoute module="stock_receipt" action="read"><StockReceiptListPage /></RequirePermissionRoute> },
      { path: 'inventory/receipts/new', element: <RequirePermissionRoute module="stock_receipt" action="create"><StockReceiptFormPage /></RequirePermissionRoute> },
      { path: 'inventory/receipts/:id', element: <RequirePermissionRoute module="stock_receipt" action="read"><StockReceiptFormPage /></RequirePermissionRoute> },
      { path: 'inventory/balances', element: <RequirePermissionRoute module="stock_receipt" action="read"><StockBalancePage /></RequirePermissionRoute> },
      { path: 'inventory/dispense', element: <RequirePermissionRoute module="stock_issue" action="read"><DispenseQueuePage /></RequirePermissionRoute> },
      { path: 'inventory/issues', element: <RequirePermissionRoute module="stock_issue" action="read"><StockIssueListPage /></RequirePermissionRoute> },
      { path: 'inventory/counts', element: <RequirePermissionRoute module="stock_count" action="read"><StockCountListPage /></RequirePermissionRoute> },
      { path: 'inventory/counts/new', element: <RequirePermissionRoute module="stock_count" action="create"><StockCountFormPage /></RequirePermissionRoute> },
      { path: 'inventory/counts/:id', element: <RequirePermissionRoute module="stock_count" action="read"><StockCountFormPage /></RequirePermissionRoute> },
      { path: 'inventory/transfers', element: <RequirePermissionRoute module="stock_transfer" action="read"><StockTransferListPage /></RequirePermissionRoute> },
      { path: 'inventory/transfers/new', element: <RequirePermissionRoute module="stock_transfer" action="create"><StockTransferFormPage /></RequirePermissionRoute> },
      { path: 'inventory/transfers/:id', element: <RequirePermissionRoute module="stock_transfer" action="read"><StockTransferFormPage /></RequirePermissionRoute> },
      // "Đăng ký ca làm việc" (Giai đoạn 2 #101).
      { path: 'work-schedule/mine', element: <RequirePermissionRoute module="work_shift_assignment" action="read"><MyWorkSchedulePage /></RequirePermissionRoute> },
      { path: 'work-schedule/staff', element: <RequirePermissionRoute module="work_shift_assignment" action="read"><StaffWorkSchedulePage /></RequirePermissionRoute> },
      // Trình duyệt hay gợi ý gõ tắt "/admin" (rút gọn từ lịch sử "/admin/catalog") — chưa từng
      // là route thật, trước đây báo lỗi 404 mặc định của react-router (docs/DECISIONS.md #048).
      { path: 'admin', element: <Navigate to="/admin/catalog" replace /> },
      { path: 'admin/catalog', element: <RequirePermissionRoute module="reference_catalog" action="manage"><CatalogAdminPage /></RequirePermissionRoute> },
      // ADM-07 (Vai trò & Phân quyền) + mở rộng ADM-01 (Quản lý tài khoản, danh mục nhân sự) — gộp
      // 3 tính năng khác quyền, xem `ADMIN_ORG_PERMISSIONS`.
      {
        path: 'admin/catalog-organization',
        element: (
          <RequireAnyPermissionRoute permissions={ADMIN_ORG_PERMISSIONS}>
            <RolePermissionPage />
          </RequireAnyPermissionRoute>
        ),
      },
      // S3-01 (mở khoá một phần) — trang tra cứu ICD-10 thật, thay ComingSoonPage cũ. Backend tái
      // dùng `patient.read` (mọi vai trò lâm sàng đều có) nên KHÔNG gate theo permission đó ở đây
      // (sẽ lộ mục "Quản trị" cho bác sĩ/điều dưỡng/lễ tân) — theo BẤT KỲ quyền quản trị nào, khớp
      // đúng cách Sidebar.tsx quyết định hiện mục này.
      {
        path: 'admin/catalog-clinical',
        element: (
          <RequireAnyPermissionRoute permissions={ADMIN_ANY_PERMISSIONS}>
            <CatalogClinicalPage />
          </RequireAnyPermissionRoute>
        ),
      },
      {
        path: 'admin/catalog-paraclinical',
        element: (
          <RequireAnyPermissionRoute permissions={ADMIN_ANY_PERMISSIONS}>
            <ComingSoonPage
              pageTitle="Danh mục Cận lâm sàng"
              icon={Flask}
              description="Danh mục xét nghiệm, chẩn đoán hình ảnh sẽ quản lý được ở đây khi module tương ứng ra đời."
            />
          </RequireAnyPermissionRoute>
        ),
      },
      // Sprint 4, S4-03 — trang "Danh mục thuốc" thật, thay ComingSoonPage cũ. Mở rộng thành "Danh
      // mục Thuốc và Vật Tư" (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — Thuốc/Vật tư y
      // tế/Kho, vẫn chưa có tồn kho/nhập-xuất (GĐ2-3, chưa xây). "Nhà cung cấp" tách sang route
      // riêng /suppliers, xem dưới.
      {
        path: 'admin/catalog-pharmacy',
        element: (
          <RequireAnyPermissionRoute permissions={DRUG_MANAGE_PERMISSIONS}>
            <PharmacyCatalogPage />
          </RequireAnyPermissionRoute>
        ),
      },
      // "Danh mục kho" — tách khỏi "Thuốc & Vật tư" thành trang riêng (docs/DECISIONS.md #157, cùng
      // quyền drug.create/drug.update, không permission mới).
      {
        path: 'admin/catalog-warehouse',
        element: (
          <RequireAnyPermissionRoute permissions={DRUG_MANAGE_PERMISSIONS}>
            <WarehouseCatalogPage />
          </RequireAnyPermissionRoute>
        ),
      },
      // "Quản lý nhà cung cấp" — nhóm sidebar riêng, tách khỏi "Danh mục Thuốc và Vật Tư" (cùng
      // quyền drug.create/drug.update, tách từ drug.manage gộp cũ #156, không permission mới).
      {
        path: 'suppliers',
        element: (
          <RequireAnyPermissionRoute permissions={DRUG_MANAGE_PERMISSIONS}>
            <SupplierManagementPage />
          </RequireAnyPermissionRoute>
        ),
      },
      { path: 'admin/system-config', element: <RequirePermissionRoute module="clinic_config" action="update"><ClinicConfigPage /></RequirePermissionRoute> },
      // S5-05 (ADM-03) — "Nhật ký hoạt động", lọc theo bệnh nhân/người dùng/khoảng ngày.
      { path: 'admin/activity-log', element: <RequirePermissionRoute module="audit_log" action="read"><ActivityLogPage /></RequirePermissionRoute> },
      // Bắt mọi đường dẫn con không khớp — thay trang trắng 404 mặc định của react-router bằng
      // trang thương hiệu (docs/DECISIONS.md #048). Route `*` ở đây đã phủ hầu hết trường hợp
      // thật (`RequireAuth` chặn lúc chưa đăng nhập, chuyển `/login` TRƯỚC khi Outlet render tới
      // route này — không cần thêm `*` cấp gốc ngoài `AppShell`, sẽ không bao giờ khớp tới).
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);