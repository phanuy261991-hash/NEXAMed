import { useState } from 'react';
import {
  CalendarBlank,
  CaretRight,
  ClipboardText,
  Clock,
  ClockCounterClockwise,
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
  UserPlus,
  Users,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/auth.store';
import { useHasAnyPermission, useDataScope, useHasPermission } from '../../features/auth/usePermission';
import { ADMIN_ANY_PERMISSIONS, ADMIN_ORG_PERMISSIONS } from '../../features/auth/admin-permissions';
import { DOCTOR_QUEUE_ROLES } from '../../features/auth/workflow-roles';
import { useSidebar } from './sidebar.context';

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
 * đó. Loại trừ `EXAMINATION_GROUP_PATH` vì cùng tiền tố `/reception` nhưng nay thuộc nhóm khác. */
const RECEPTION_GROUP_PATHS = ['/patients', '/appointments', '/reception'];
/** Đường dẫn thuộc nhóm "Thu ngân" — hiện chỉ có "Danh sách cần thu" (`/billing`), tách nhóm cha/con
 * cùng khuôn "Khám bệnh" để sau này thêm mục con (vd tổng kết ca) không phải đổi lại cấu trúc. */
const BILLING_GROUP_PATHS = ['/billing'];
/** Đường dẫn thuộc nhóm "Lịch làm việc" (Giai đoạn 2 #101). */
const WORK_SCHEDULE_GROUP_PATHS = ['/work-schedule'];
/** Đường dẫn thuộc nhóm "Quản trị" — có 2 mục con thật (Danh mục dùng chung, Cấu hình hệ thống) và
 * 4 mục "Sắp ra mắt" đặt chỗ theo yêu cầu chủ dự án (docs/DECISIONS.md #046, ComingSoonPage — vẫn
 * KHÔNG viết logic/schema nghiệp vụ, không mở rộng phạm vi v1). Thêm ADM-01/03 vào đây khi có UI
 * thật. */
const ADMIN_GROUP_PATHS = ['/admin'];

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
 */
export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const { collapsed, setCollapsed } = useSidebar();
  const [receptionGroupOpen, setReceptionGroupOpen] = useState(
    RECEPTION_GROUP_PATHS.some((path) => location.pathname.startsWith(path)) &&
      !location.pathname.startsWith(EXAMINATION_GROUP_PATH),
  );
  const [examinationGroupOpen, setExaminationGroupOpen] = useState(
    location.pathname.startsWith(EXAMINATION_GROUP_PATH),
  );
  const [adminGroupOpen, setAdminGroupOpen] = useState(
    ADMIN_GROUP_PATHS.some((path) => location.pathname.startsWith(path)),
  );
  const [billingGroupOpen, setBillingGroupOpen] = useState(
    BILLING_GROUP_PATHS.some((path) => location.pathname.startsWith(path)),
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
  const canSeeCatalogPharmacy = useHasPermission('drug', 'manage');
  const canSeeSystemConfig = useHasPermission('clinic_config', 'update');
  const canSeeActivityLog = useHasPermission('audit_log', 'read');
  const canSeePatients = useHasPermission('patient', 'read');
  const canSeeAppointments = useHasPermission('appointment', 'read');
  const canSeeReception = useHasPermission('encounter', 'read');
  // "Hàng đợi khám" — quyết định workflow (không phải quyền), giữ theo tên vai trò, xem DOCTOR_QUEUE_ROLES.
  const canSeeDoctorQueue = user?.roles.some((role) => DOCTOR_QUEUE_ROLES.includes(role)) ?? false;
  const canSeeBilling = useHasPermission('invoice', 'read');
  const canSeeWorkSchedule = useHasPermission('work_shift_assignment', 'create');
  // "Lịch làm việc nhân viên" — chỉ actor có scope GLOBAL (quản lý toàn phòng khám) mới thấy mục
  // này, khác canSeeWorkSchedule (personal cũng đủ để thấy "Lịch làm việc của tôi").
  const canSeeStaffSchedule = useDataScope('work_shift_assignment', 'read') === 'global';
  const receptionGroupExpanded = receptionGroupOpen && !collapsed;
  const examinationGroupExpanded = examinationGroupOpen && !collapsed;
  const adminGroupExpanded = adminGroupOpen && !collapsed;
  const billingGroupExpanded = billingGroupOpen && !collapsed;
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

          {(canSeePatients || canSeeAppointments || canSeeReception) && (
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
                  {canSeeReception && <NavItem to="/reception" label="Danh sách tiếp nhận" icon={ClipboardText} end collapsed={false} indent />}
                  {canSeePatients && <NavItem to="/patients" label="Danh sách bệnh nhân" icon={Users} collapsed={false} indent />}
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
                  {/* Đổi nhãn từ "Danh mục Dược và Vật tư" (Sprint 4) — v1 chỉ quản lý danh mục thuốc, không vật tư/kho (docs/product/future-modules-reference.md mục 2.2.1). */}
                  {canSeeCatalogPharmacy && <NavItem to="/admin/catalog-pharmacy" label="Danh mục thuốc" icon={Pill} collapsed={false} indent />}
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
