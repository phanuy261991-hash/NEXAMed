import { useState } from 'react';
import {
  Archive,
  CalendarBlank,
  CaretRight,
  ChartBar,
  ClipboardText,
  Clock,
  ClockCounterClockwise,
  Export,
  FileText,
  Flask,
  FolderSimple,
  GearSix,
  GraduationCap,
  House,
  ListChecks,
  Pill,
  Receipt,
  SidebarSimple,
  SlidersHorizontal,
  Stethoscope,
  Truck,
  UserPlus,
  Users,
  Vault,
  Warehouse,
  BookOpen,
  ChartLine,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/auth.store';
import { useHasAnyPermission, useDataScope, useHasPermission } from '../../features/auth/usePermission';
import { ADMIN_ANY_PERMISSIONS, ADMIN_ORG_PERMISSIONS, DRUG_MANAGE_PERMISSIONS } from '../../features/auth/admin-permissions';
import { DOCTOR_QUEUE_ROLES } from '../../features/auth/workflow-roles';
import { useSidebarAutoCollapseEnabledQuery } from '../../features/clinic/clinic.queries';
import { useAutoCollapseSidebarOnNavigate, useSidebar } from './sidebar.context';

/**
 * 7 mục con của "Quản trị" (2026-09-04) — TỪNG mục ẩn/hiện theo ĐÚNG quyền route đó cần, không
 * còn 1 khối chung theo tên vai trò cứng: trước đây thu hồi hết quyền quản trị của 1 vai trò qua
 * "Vai trò & Phân quyền" không ẩn được menu (bug thật, xem `docs/DECISIONS.md`); sau khi sửa còn
 * lỗ hổng kế tiếp — 1 khối gộp cả 6 mục theo BẤT KỲ quyền quản trị nào khiến vai trò tuỳ biến chỉ
 * được cấp 1 phần (ví dụ chỉ `audit_log.read`) vẫn thấy đủ 6 mục nhưng bấm vào 5 mục kia bị route
 * guard chặn — nay mỗi mục tự kiểm tra đúng quyền route đó cần (khớp tuyệt đối
 * `RequirePermissionRoute`/`RequireAnyPermissionRoute` ở `router.tsx`, 2 danh sách quyền dùng
 * chung đặt ở `features/auth/admin-permissions.ts`).
 */

/** Route của "Hàng đợi khám" — giữ nguyên dưới `features/reception/` (chưa có module `encounter`/
 * `examination` thật ở web), chỉ đổi vị trí hiển thị sang nhóm "Khám bệnh" trong sidebar. */
const EXAMINATION_GROUP_PATH = '/reception/doctor-queue';
/** Đường dẫn thuộc nhóm "Tiếp nhận và Đặt lịch" — dùng để tự mở nhóm khi route đang active nằm trong
 * đó. Loại trừ `EXAMINATION_GROUP_PATH` vì cùng tiền tố `/reception` nhưng nay thuộc nhóm khác.
 * KHÔNG còn `/patients` (2026-09-08) — "Danh sách bệnh nhân" đã chuyển sang nhóm "Hồ sơ Bệnh nhân"
 * riêng, xem `PATIENT_RECORDS_GROUP_PATHS`. */
const RECEPTION_GROUP_PATHS = ['/appointments', '/reception'];
/** Đường dẫn thuộc nhóm "Hồ sơ Bệnh nhân" (tách khỏi "Tiếp nhận và Đặt lịch", 2026-09-08, chủ dự án
 * yêu cầu trực tiếp — đặt ngay dưới "Khám bệnh") — hiện chỉ có "Danh sách bệnh nhân", cùng khuôn
 * "Thu ngân" (1 mục con thật vẫn dựng dạng nhóm cha/con để mở rộng thêm mục sau này không phải đổi
 * lại cấu trúc). Gate bằng ĐÚNG quyền route `/patients*` cần (`patient.read`) — không đổi permission
 * nào, chỉ đổi vị trí hiển thị trong sidebar. */
const PATIENT_RECORDS_GROUP_PATHS = ['/patients'];
/** Đường dẫn thuộc nhóm "Thu ngân" — hiện chỉ có "Danh sách cần thu" (`/billing`), tách nhóm cha/con
 * cùng khuôn "Khám bệnh" để sau này thêm mục con (vd tổng kết ca) không phải đổi lại cấu trúc. */
const BILLING_GROUP_PATHS = ['/billing'];
/** Đường dẫn thuộc nhóm "Sổ quỹ & Thu chi" (Sổ quỹ & Thu chi GĐ1, ngoài kế hoạch, 2026-09-05). */
const CASH_BOOK_GROUP_PATHS = ['/cash-book'];
/** Đường dẫn thuộc nhóm "Lịch làm việc" (Giai đoạn 2 #101). */
const WORK_SCHEDULE_GROUP_PATHS = ['/work-schedule'];
/** Đường dẫn thuộc nhóm "Quản lý kho" (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — tách
 * "Danh mục Thuốc và Vật Tư" khỏi "Quản trị" theo yêu cầu chủ dự án, đặt ngay dưới "Sổ quỹ & Thu
 * chi". Route GIỮ NGUYÊN `/admin/catalog-pharmacy` (không đổi permission/route, chỉ đổi vị trí
 * hiển thị trong sidebar — cùng cách đã làm với "Hồ sơ Bệnh nhân"/`PATIENT_RECORDS_GROUP_PATHS`). */
const WAREHOUSE_GROUP_PATHS = ['/admin/catalog-pharmacy', '/inventory/receipts', '/inventory/balances', '/inventory/dispense', '/inventory/issues', '/inventory/counts'];
/** Đường dẫn thuộc nhóm "Quản lý nhà cung cấp" — tách "Nhà cung cấp" khỏi pill con của "Danh mục
 * Thuốc và Vật Tư" thành trang/nhóm menu riêng (route mới `/suppliers`, cùng quyền `drug.create`/
 * `drug.update`, tách từ `drug.manage` gộp cũ #156). */
const SUPPLIER_GROUP_PATHS = ['/suppliers'];
/** Đường dẫn thuộc nhóm "Quản trị" — có 2 mục con thật (Danh mục dùng chung, Cấu hình hệ thống) và
 * 4 mục "Sắp ra mắt" đặt chỗ theo yêu cầu chủ dự án (docs/DECISIONS.md #046, ComingSoonPage — vẫn
 * KHÔNG viết logic/schema nghiệp vụ, không mở rộng phạm vi v1). Thêm ADM-01/03 vào đây khi có UI
 * thật. Danh sách CHÍNH XÁC (không phải tiền tố `/admin`) — `/admin/catalog-pharmacy` đã tách sang
 * "Quản lý kho" ở trên, và so khớp tiền tố đơn giản sẽ khớp nhầm (`/admin/catalog-pharmacy` bắt
 * đầu bằng `/admin/catalog`). */
const ADMIN_GROUP_PATHS = [
  '/admin/catalog',
  '/admin/catalog-organization',
  '/admin/catalog-clinical',
  '/admin/catalog-paraclinical',
  // "Danh mục kho" — chuyển từ nhóm "Quản lý kho" xuống đây theo yêu cầu chủ dự án (16/09/2026,
  // docs/DECISIONS.md #157), route/quyền giữ nguyên (`/admin/catalog-pharmacy` KHÔNG chuyển).
  '/admin/catalog-warehouse',
  '/admin/system-config',
  '/admin/activity-log',
];

interface NavItemProps {
  to: string;
  label: string;
  icon: Icon;
  end?: boolean;
  collapsed: boolean;
  indent?: boolean;
}

function NavItem({ to, label, icon: IconComponent, end, collapsed, indent }: NavItemProps) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        title={collapsed ? label : undefined}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors ${
            collapsed ? 'justify-center px-2' : indent ? 'px-2.5' : 'px-3'
          } ${isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'}`
      }
      >
        {({ isActive }) => (
          <>
            <IconComponent size={collapsed ? 20 : 18} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" className="flex-shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </>
        )}
      </NavLink>
    </li>
  );
}

/**
 * Sidebar cố định trái, tự quản lý container (`<aside>`) + trạng thái thu gọn — theo App Shell v2
 * (.claude/docs/ui-guidelines.md mục 8.1, docs/DECISIONS.md #027). Ba vùng: logo → menu (nhóm
 * cha/con, chỉ hiện mục đã có backend thật) → nút thu gọn. Trạng thái thu gọn không lưu giữa các
 * phiên ở v1 (chưa có yêu cầu cụ thể).
 *
 * "Tự động thu gọn menu khi chuyển trang" (2026-09-07) — `useAutoCollapseSidebarOnNavigate()` ép
 * thu gọn mỗi lần đổi route khi tenant bật `sidebarAutoCollapseEnabled` ("Cấu hình chung", pill
 * "Cấu hình phòng khám"). Độc lập với `useAutoCollapseSidebar()` (chỉ màn hình khám gọi, luôn ép
 * thu gọn CỐ ĐỊNH bất kể cờ này) — xem comment ở `sidebar.context.tsx`.
 */
export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const { collapsed, setCollapsed } = useSidebar();
  const sidebarAutoCollapseQuery = useSidebarAutoCollapseEnabledQuery();
  useAutoCollapseSidebarOnNavigate(sidebarAutoCollapseQuery.data?.enabled ?? false);
  const [receptionGroupOpen, setReceptionGroupOpen] = useState(
    RECEPTION_GROUP_PATHS.some((path) => location.pathname.startsWith(path)) &&
      !location.pathname.startsWith(EXAMINATION_GROUP_PATH),
  );
  const [examinationGroupOpen, setExaminationGroupOpen] = useState(
    location.pathname.startsWith(EXAMINATION_GROUP_PATH),
  );
  const [patientRecordsGroupOpen, setPatientRecordsGroupOpen] = useState(
    PATIENT_RECORDS_GROUP_PATHS.some((path) => location.pathname.startsWith(path)),
  );
  const [adminGroupOpen, setAdminGroupOpen] = useState(
    // So khớp CHÍNH XÁC (không phải tiền tố) — xem comment ở khai báo ADMIN_GROUP_PATHS.
    ADMIN_GROUP_PATHS.includes(location.pathname),
  );
  const [billingGroupOpen, setBillingGroupOpen] = useState(
    BILLING_GROUP_PATHS.some((path) => location.pathname.startsWith(path)),
  );
  const [cashBookGroupOpen, setCashBookGroupOpen] = useState(
    CASH_BOOK_GROUP_PATHS.some((path) => location.pathname.startsWith(path)),
  );
  const [warehouseGroupOpen, setWarehouseGroupOpen] = useState(
    WAREHOUSE_GROUP_PATHS.some((path) => location.pathname.startsWith(path)),
  );
  const [supplierGroupOpen, setSupplierGroupOpen] = useState(
    SUPPLIER_GROUP_PATHS.some((path) => location.pathname.startsWith(path)),
  );
  const [workScheduleGroupOpen, setWorkScheduleGroupOpen] = useState(
    WORK_SCHEDULE_GROUP_PATHS.some((path) => location.pathname.startsWith(path)),
  );

  const isAdmin = useHasAnyPermission(ADMIN_ANY_PERMISSIONS);
  const canSeeCatalog = useHasPermission('reference_catalog', 'manage');
  const canSeeCatalogOrganization = useHasAnyPermission(ADMIN_ORG_PERMISSIONS);
  // ICD-10 tái dùng patient.read ở backend (không có permission "manage" riêng, xem
  // .claude/docs/multi-tenancy.md) — sẽ lộ menu này cho cả bác sĩ/điều dưỡng/lễ tân nếu tra thẳng
  // patient.read (họ đều có), sai tinh thần "chỉ Quản trị" của cả nhóm — theo BẤT KỲ quyền quản
  // trị nào thay vì permission route thật sự dùng, xem comment ADMIN_ANY_PERMISSIONS phía trên.
  const canSeeCatalogClinical = isAdmin;
  // "Danh mục cận lâm sàng" còn là ComingSoonPage, chưa có permission route thật — cùng lý do trên.
  const canSeeCatalogParaclinical = isAdmin;
  const canSeeCatalogPharmacy = useHasAnyPermission(DRUG_MANAGE_PERMISSIONS);
  // Kho Thuốc GĐ2 — "Phiếu nhập kho"/"Tồn kho" (docs/DECISIONS.md #146), gate riêng khỏi
  // `canSeeCatalogPharmacy` (danh mục thuốc) — điều dưỡng/bác sĩ có `stock_receipt.read` (xem tồn)
  // nhưng KHÔNG có `drug.create`/`drug.update`.
  const canSeeInventory = useHasPermission('stock_receipt', 'read');
  // Kho Thuốc GĐ3 — "Phát thuốc" (docs/DECISIONS.md #163), gate riêng theo `stock_issue.read`
  // (lễ tân có quyền này để biết đã phát gì, dù không tự phát thuốc được — `.create` riêng).
  const canSeeDispenseQueue = useHasPermission('stock_issue', 'read');
  // Kho Thuốc GĐ4, phần "Kiểm kê" (docs/DECISIONS.md #170), gate riêng theo `stock_count.read`.
  const canSeeStockCount = useHasPermission('stock_count', 'read');
  const canSeeSystemConfig = useHasPermission('clinic_config', 'update');
  const canSeeActivityLog = useHasPermission('audit_log', 'read');
  const canSeePatients = useHasPermission('patient', 'read');
  const canSeeAppointments = useHasPermission('appointment', 'read');
  const canSeeReception = useHasPermission('encounter', 'read');
  // "Hàng đợi khám" — quyết định workflow (không phải quyền), giữ theo tên vai trò, xem DOCTOR_QUEUE_ROLES.
  const canSeeDoctorQueue = user?.roles.some((role) => DOCTOR_QUEUE_ROLES.includes(role)) ?? false;
  const canSeeBilling = useHasPermission('invoice', 'read');
  const canSeeCashBook = useHasPermission('cash_voucher', 'read');
  // "Báo cáo dòng tiền" (Sổ quỹ & Thu chi GĐ2) — báo cáo quản trị tổng hợp toàn phòng khám, CHỈ
  // clinic_admin (`cash_voucher.report`), khác "Phiếu thu/chi"/"Sổ quỹ" (receptionist cũng thấy).
  const canSeeCashFlowReport = useHasPermission('cash_voucher', 'report');
  // "Ví tạm ứng" tổng hợp toàn phòng khám — chỉ ai tất toán được (clinic_admin) mới cần xem trang này.
  const canSeeWallets = useHasPermission('patient_wallet', 'settle');
  const canSeeWorkSchedule = useHasPermission('work_shift_assignment', 'create');
  // "Lịch làm việc nhân viên" — chỉ actor có scope GLOBAL (quản lý toàn phòng khám) mới thấy mục
  // này, khác canSeeWorkSchedule (personal cũng đủ để thấy "Lịch làm việc của tôi").
  const canSeeStaffSchedule = useDataScope('work_shift_assignment', 'read') === 'global';
  const receptionGroupExpanded = receptionGroupOpen && !collapsed;
  const examinationGroupExpanded = examinationGroupOpen && !collapsed;
  const patientRecordsGroupExpanded = patientRecordsGroupOpen && !collapsed;
  const adminGroupExpanded = adminGroupOpen && !collapsed;
  const billingGroupExpanded = billingGroupOpen && !collapsed;
  const cashBookGroupExpanded = cashBookGroupOpen && !collapsed;
  const warehouseGroupExpanded = warehouseGroupOpen && !collapsed;
  const supplierGroupExpanded = supplierGroupOpen && !collapsed;
  const workScheduleGroupExpanded = workScheduleGroupOpen && !collapsed;

  return (
    <aside
      className={`flex h-full flex-shrink-0 flex-col bg-slate-900 text-white transition-[width] duration-150 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className="flex h-14 flex-shrink-0 items-center gap-2.5 border-b border-slate-800 px-4">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-extrabold">
          NX
        </div>
        {!collapsed && <span className="truncate text-[15px] font-bold">NEXAMed</span>}
      </div>

      <nav className="scroll-hover flex-1 overflow-y-auto p-2.5" aria-label="Điều hướng chính">
        <ul className="flex flex-col gap-0.5">
          <NavItem to="/" label="Tổng quan" icon={House} end collapsed={collapsed} />

          {(canSeeAppointments || canSeeReception) && (
            <li>
              <button
                type="button"
                title={collapsed ? 'Tiếp nhận và Đặt lịch' : undefined}
                onClick={() => {
                  if (collapsed) {
                    // Thu gọn thì bấm icon phải mở lại sidebar (không chỉ toggle accordion ẩn) —
                    // nếu không, icon nhóm menu trông như bấm được nhưng không có phản hồi gì.
                    setCollapsed(false);
                    setReceptionGroupOpen(true);
                  } else {
                    setReceptionGroupOpen((v) => !v);
                  }
                }}
                aria-expanded={receptionGroupExpanded}
                className={`flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white ${
                  collapsed ? 'justify-center px-2' : 'px-3'
                }`}
              >
                <CalendarBlank size={collapsed ? 20 : 18} weight="regular" aria-hidden="true" className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate text-left">Tiếp nhận và Đặt lịch</span>
                    <CaretRight
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                      className={`ml-auto flex-shrink-0 transition-transform ${receptionGroupExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>
              {receptionGroupExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-800 pl-3.5">
                  {canSeeAppointments && <NavItem to="/appointments" label="Lịch hẹn" icon={CalendarBlank} collapsed={false} indent />}
                  {canSeeReception && <NavItem to="/reception/new" label="Tiếp nhận bệnh nhân" icon={UserPlus} collapsed={false} indent />}
                  {canSeeReception && <NavItem to="/reception" label="Bệnh nhân trong ngày" icon={ClipboardText} end collapsed={false} indent />}
                </ul>
              )}
            </li>
          )}

          {canSeeDoctorQueue && (
            <li>
              <button
                type="button"
                title={collapsed ? 'Khám bệnh' : undefined}
                onClick={() => {
                  if (collapsed) {
                    // Cùng quy tắc bắt buộc ở nhóm "Tiếp nhận và Đặt lịch" (.claude/docs/
                    // ui-guidelines.md mục 8.1/8.3): bấm icon lúc thu gọn phải mở lại sidebar.
                    setCollapsed(false);
                    setExaminationGroupOpen(true);
                  } else {
                    setExaminationGroupOpen((v) => !v);
                  }
                }}
                aria-expanded={examinationGroupExpanded}
                className={`flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white ${
                  collapsed ? 'justify-center px-2' : 'px-3'
                }`}
              >
                <Stethoscope size={collapsed ? 20 : 18} weight="regular" aria-hidden="true" className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate text-left">Khám bệnh</span>
                    <CaretRight
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                      className={`ml-auto flex-shrink-0 transition-transform ${examinationGroupExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>
              {examinationGroupExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-800 pl-3.5">
                  <NavItem to={EXAMINATION_GROUP_PATH} label="Hàng đợi khám" icon={ListChecks} collapsed={false} indent />
                </ul>
              )}
            </li>
          )}

          {/* "Hồ sơ Bệnh nhân" (2026-09-08, chủ dự án yêu cầu trực tiếp) — tách khỏi "Tiếp nhận và
              Đặt lịch", đặt ngay dưới "Khám bệnh". Gate bằng ĐÚNG quyền route `/patients*` cần
              (`canSeePatients`) — không đổi permission nào, chỉ đổi vị trí hiển thị trong sidebar. */}
          {canSeePatients && (
            <li>
              <button
                type="button"
                title={collapsed ? 'Hồ sơ Bệnh nhân' : undefined}
                onClick={() => {
                  if (collapsed) {
                    // Cùng quy tắc bắt buộc ở nhóm "Tiếp nhận và Đặt lịch" (.claude/docs/
                    // ui-guidelines.md mục 8.1/8.3): bấm icon lúc thu gọn phải mở lại sidebar.
                    setCollapsed(false);
                    setPatientRecordsGroupOpen(true);
                  } else {
                    setPatientRecordsGroupOpen((v) => !v);
                  }
                }}
                aria-expanded={patientRecordsGroupExpanded}
                className={`flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white ${
                  collapsed ? 'justify-center px-2' : 'px-3'
                }`}
              >
                <FileText size={collapsed ? 20 : 18} weight="regular" aria-hidden="true" className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate text-left">Hồ sơ Bệnh nhân</span>
                    <CaretRight
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                      className={`ml-auto flex-shrink-0 transition-transform ${patientRecordsGroupExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>
              {patientRecordsGroupExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-800 pl-3.5">
                  <NavItem to="/patients" label="Danh sách bệnh nhân" icon={Users} collapsed={false} indent />
                </ul>
              )}
            </li>
          )}

          {canSeeBilling && (
            <li>
              <button
                type="button"
                title={collapsed ? 'Thu ngân' : undefined}
                onClick={() => {
                  if (collapsed) {
                    // Cùng quy tắc bắt buộc ở nhóm "Tiếp nhận và Đặt lịch" (.claude/docs/
                    // ui-guidelines.md mục 8.1/8.3): bấm icon lúc thu gọn phải mở lại sidebar.
                    setCollapsed(false);
                    setBillingGroupOpen(true);
                  } else {
                    setBillingGroupOpen((v) => !v);
                  }
                }}
                aria-expanded={billingGroupExpanded}
                className={`flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white ${
                  collapsed ? 'justify-center px-2' : 'px-3'
                }`}
              >
                <Wallet size={collapsed ? 20 : 18} weight="regular" aria-hidden="true" className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate text-left">Thu ngân</span>
                    <CaretRight
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                      className={`ml-auto flex-shrink-0 transition-transform ${billingGroupExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>
              {billingGroupExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-800 pl-3.5">
                  <NavItem to="/billing" label="Danh sách cần thu" icon={Receipt} end collapsed={false} indent />
                  <NavItem to="/billing/cashier-shifts" label="Phiếu chốt ca" icon={FileText} collapsed={false} indent />
                </ul>
              )}
            </li>
          )}

          {/* "Sổ quỹ & Thu chi" (Sổ quỹ & Thu chi GĐ1, ngoài kế hoạch, 2026-09-05) — phiếu thu/chi
              ngoài dịch vụ khám (tiền điện/nước, bán phế liệu...), tách nhóm riêng khỏi "Thu ngân"
              (là dòng tiền khám bệnh, khác bản chất). */}
          {(canSeeCashBook || canSeeWallets) && (
            <li>
              <button
                type="button"
                title={collapsed ? 'Sổ quỹ & Thu chi' : undefined}
                onClick={() => {
                  if (collapsed) {
                    setCollapsed(false);
                    setCashBookGroupOpen(true);
                  } else {
                    setCashBookGroupOpen((v) => !v);
                  }
                }}
                aria-expanded={cashBookGroupExpanded}
                className={`flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white ${
                  collapsed ? 'justify-center px-2' : 'px-3'
                }`}
              >
                <Vault size={collapsed ? 20 : 18} weight="regular" aria-hidden="true" className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate text-left">Sổ quỹ & Thu chi</span>
                    <CaretRight
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                      className={`ml-auto flex-shrink-0 transition-transform ${cashBookGroupExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>
              {cashBookGroupExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-800 pl-3.5">
                  <NavItem to="/cash-book/vouchers" label="Phiếu thu / Phiếu chi" icon={Vault} end collapsed={false} indent />
                  <NavItem to="/cash-book/ledger" label="Sổ quỹ" icon={BookOpen} collapsed={false} indent />
                  {canSeeCashFlowReport && <NavItem to="/cash-book/report" label="Báo cáo dòng tiền" icon={ChartLine} collapsed={false} indent />}
                  {canSeeWallets && <NavItem to="/cash-book/wallets" label="Ví tạm ứng" icon={Wallet} collapsed={false} indent />}
                </ul>
              )}
            </li>
          )}

          {/* "Quản lý kho" (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — tách khỏi
              "Quản trị" theo yêu cầu chủ dự án, route giữ nguyên /admin/catalog-pharmacy. GĐ2
              (#146) thêm "Phiếu nhập kho"/"Tồn kho" — nhóm hiện cả khi chỉ có stock_receipt.read
              (điều dưỡng/bác sĩ xem tồn, không quản lý danh mục thuốc). */}
          {(canSeeCatalogPharmacy || canSeeInventory || canSeeDispenseQueue || canSeeStockCount) && (
            <li>
              <button
                type="button"
                title={collapsed ? 'Quản lý kho' : undefined}
                onClick={() => {
                  if (collapsed) {
                    setCollapsed(false);
                    setWarehouseGroupOpen(true);
                  } else {
                    setWarehouseGroupOpen((v) => !v);
                  }
                }}
                aria-expanded={warehouseGroupExpanded}
                className={`flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white ${
                  collapsed ? 'justify-center px-2' : 'px-3'
                }`}
              >
                <Warehouse size={collapsed ? 20 : 18} weight="regular" aria-hidden="true" className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate text-left">Quản lý kho</span>
                    <CaretRight
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                      className={`ml-auto flex-shrink-0 transition-transform ${warehouseGroupExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>
              {warehouseGroupExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-800 pl-3.5">
                  {canSeeCatalogPharmacy && <NavItem to="/admin/catalog-pharmacy" label="Thuốc & Vật tư" icon={Pill} collapsed={false} indent />}
                  {/* Kho Thuốc GĐ2 (docs/DECISIONS.md #146, kế hoạch precious-humming-goblet.md) — "Tồn kho"/"Phiếu nhập kho". */}
                  {canSeeInventory && <NavItem to="/inventory/balances" label="Tồn kho" icon={ChartBar} collapsed={false} indent />}
                  {canSeeInventory && <NavItem to="/inventory/receipts" label="Phiếu nhập kho" icon={Archive} collapsed={false} indent />}
                  {/* Kho Thuốc GĐ3 (docs/DECISIONS.md #163) — "Phát thuốc". */}
                  {canSeeDispenseQueue && <NavItem to="/inventory/dispense" label="Phát thuốc" icon={Pill} collapsed={false} indent />}
                  {/* Rà soát lỗ hổng quy trình 22/09/2026 (docs/DECISIONS.md #171) — liệt kê MỌI
                      phiếu xuất (phát thuốc + xuất cân bằng kiểm kê), cùng quyền `stock_issue.read`
                      với "Phát thuốc". */}
                  {canSeeDispenseQueue && <NavItem to="/inventory/issues" label="Phiếu xuất kho" icon={Export} collapsed={false} indent />}
                  {/* Kho Thuốc GĐ4, phần "Kiểm kê" (docs/DECISIONS.md #170). */}
                  {canSeeStockCount && <NavItem to="/inventory/counts" label="Kiểm kê" icon={ClipboardText} collapsed={false} indent />}
                </ul>
              )}
            </li>
          )}

          {/* "Quản lý nhà cung cấp" — tách "Nhà cung cấp" khỏi pill con của "Danh mục Thuốc và Vật
              Tư" thành trang/nhóm menu riêng theo yêu cầu chủ dự án, đặt ngay dưới "Quản lý kho". */}
          {canSeeCatalogPharmacy && (
            <li>
              <button
                type="button"
                title={collapsed ? 'Quản lý nhà cung cấp' : undefined}
                onClick={() => {
                  if (collapsed) {
                    setCollapsed(false);
                    setSupplierGroupOpen(true);
                  } else {
                    setSupplierGroupOpen((v) => !v);
                  }
                }}
                aria-expanded={supplierGroupExpanded}
                className={`flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white ${
                  collapsed ? 'justify-center px-2' : 'px-3'
                }`}
              >
                <Truck size={collapsed ? 20 : 18} weight="regular" aria-hidden="true" className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate text-left">Quản lý nhà cung cấp</span>
                    <CaretRight
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                      className={`ml-auto flex-shrink-0 transition-transform ${supplierGroupExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>
              {supplierGroupExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-800 pl-3.5">
                  <NavItem to="/suppliers" label="Nhà cung cấp" icon={Truck} collapsed={false} indent />
                </ul>
              )}
            </li>
          )}

          {canSeeWorkSchedule && (
            <li>
              <button
                type="button"
                title={collapsed ? 'Lịch làm việc' : undefined}
                onClick={() => {
                  if (collapsed) {
                    // Cùng quy tắc bắt buộc ở nhóm "Tiếp nhận và Đặt lịch" (.claude/docs/
                    // ui-guidelines.md mục 8.1/8.3): bấm icon lúc thu gọn phải mở lại sidebar.
                    setCollapsed(false);
                    setWorkScheduleGroupOpen(true);
                  } else {
                    setWorkScheduleGroupOpen((v) => !v);
                  }
                }}
                aria-expanded={workScheduleGroupExpanded}
                className={`flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white ${
                  collapsed ? 'justify-center px-2' : 'px-3'
                }`}
              >
                <Clock size={collapsed ? 20 : 18} weight="regular" aria-hidden="true" className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate text-left">Lịch làm việc</span>
                    <CaretRight
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                      className={`ml-auto flex-shrink-0 transition-transform ${workScheduleGroupExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>
              {workScheduleGroupExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-800 pl-3.5">
                  <NavItem to="/work-schedule/mine" label="Lịch làm việc của tôi" icon={Clock} collapsed={false} indent />
                  {canSeeStaffSchedule && <NavItem to="/work-schedule/staff" label="Lịch làm việc nhân viên" icon={Users} collapsed={false} indent />}
                </ul>
              )}
            </li>
          )}

          {isAdmin && (
            <li>
              <button
                type="button"
                title={collapsed ? 'Quản trị' : undefined}
                onClick={() => {
                  if (collapsed) {
                    // Cùng quy tắc bắt buộc ở nhóm "Tiếp nhận và Đặt lịch" (.claude/docs/
                    // ui-guidelines.md mục 8.1/8.3): bấm icon lúc thu gọn phải mở lại sidebar,
                    // không được là no-op.
                    setCollapsed(false);
                    setAdminGroupOpen(true);
                  } else {
                    setAdminGroupOpen((v) => !v);
                  }
                }}
                aria-expanded={adminGroupExpanded}
                className={`flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white ${
                  collapsed ? 'justify-center px-2' : 'px-3'
                }`}
              >
                <GearSix size={collapsed ? 20 : 18} weight="regular" aria-hidden="true" className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate text-left">Quản trị</span>
                    <CaretRight
                      size={13}
                      weight="bold"
                      aria-hidden="true"
                      className={`ml-auto flex-shrink-0 transition-transform ${adminGroupExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>
              {adminGroupExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-800 pl-3.5">
                  {canSeeCatalog && <NavItem to="/admin/catalog" label="Danh mục dùng chung" icon={FolderSimple} collapsed={false} indent />}
                  {canSeeCatalogOrganization && (
                    <NavItem to="/admin/catalog-organization" label="Danh mục Tổ chức và Nhân sự" icon={Users} collapsed={false} indent />
                  )}
                  {canSeeCatalogClinical && <NavItem to="/admin/catalog-clinical" label="Danh mục Chuyên môn" icon={GraduationCap} collapsed={false} indent />}
                  {canSeeCatalogParaclinical && (
                    <NavItem to="/admin/catalog-paraclinical" label="Danh mục cận lâm sàng" icon={Flask} collapsed={false} indent />
                  )}
                  {/* "Danh mục kho" — chuyển từ nhóm "Quản lý kho" xuống đây theo yêu cầu chủ dự án
                      (16/09/2026, docs/DECISIONS.md #157), route/quyền giữ nguyên. */}
                  {canSeeCatalogPharmacy && <NavItem to="/admin/catalog-warehouse" label="Danh mục kho" icon={Warehouse} collapsed={false} indent />}
                  {canSeeSystemConfig && <NavItem to="/admin/system-config" label="Cấu hình hệ thống" icon={SlidersHorizontal} collapsed={false} indent />}
                  {canSeeActivityLog && <NavItem to="/admin/activity-log" label="Nhật ký hoạt động" icon={ClockCounterClockwise} collapsed={false} indent />}
                </ul>
              )}
            </li>
          )}
        </ul>
      </nav>

      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex flex-shrink-0 items-center justify-center gap-2 border-t border-slate-800 py-3 text-xs font-medium text-slate-400 hover:bg-slate-800/60 hover:text-white"
      >
        <SidebarSimple size={15} weight="regular" aria-hidden="true" className={collapsed ? '' : 'rotate-180'} />
        {!collapsed && 'Thu gọn'}
      </button>
    </aside>
  );
}
