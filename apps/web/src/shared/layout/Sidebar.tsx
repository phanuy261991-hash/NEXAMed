import { useState } from 'react';
import {
  CalendarBlank,
  CaretRight,
  GearSix,
  House,
  SidebarSimple,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/auth.store';

/** Vai trò được thấy mục Quản trị — theo lựa chọn đã chốt ở S1-08 (kết hợp luồng nghiệp vụ + vai trò). */
const ADMIN_ROLES = ['clinic_admin', 'system_admin'];
/** Khớp `patient.read` trong ma trận mặc định (.claude/docs/security-audit.md) — mọi vai trò trừ system_admin. */
const PATIENT_ROLES = ['receptionist', 'nurse', 'doctor', 'clinic_admin'];
/** Khớp `appointment.read` (S2-09) — receptionist/clinic_admin=global, doctor=personal; nurse/system_admin không có (none). */
const APPOINTMENT_ROLES = ['receptionist', 'doctor', 'clinic_admin'];

/** Đường dẫn thuộc nhóm "Tiếp nhận và Đặt lịch" — dùng để tự mở nhóm khi route đang active nằm trong đó. */
const RECEPTION_GROUP_PATHS = ['/patients', '/appointments'];

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
  const [collapsed, setCollapsed] = useState(false);
  const [receptionGroupOpen, setReceptionGroupOpen] = useState(
    RECEPTION_GROUP_PATHS.some((path) => location.pathname.startsWith(path)),
  );

  const isAdmin = user?.roles.some((role) => ADMIN_ROLES.includes(role)) ?? false;
  const canSeePatients = user?.roles.some((role) => PATIENT_ROLES.includes(role)) ?? false;
  const canSeeAppointments = user?.roles.some((role) => APPOINTMENT_ROLES.includes(role)) ?? false;
  const groupExpanded = receptionGroupOpen && !collapsed;

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

      <nav className="flex-1 overflow-y-auto p-2.5" aria-label="Điều hướng chính">
        <ul className="flex flex-col gap-0.5">
          <NavItem to="/" label="Tổng quan" icon={House} end collapsed={collapsed} />

          {(canSeePatients || canSeeAppointments) && (
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
                aria-expanded={groupExpanded}
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
                      className={`ml-auto flex-shrink-0 transition-transform ${groupExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>
              {groupExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-800 pl-3.5">
                  {canSeePatients && <NavItem to="/patients" label="Danh sách bệnh nhân" icon={Users} collapsed={false} indent />}
                  {canSeeAppointments && <NavItem to="/appointments" label="Lịch hẹn" icon={CalendarBlank} collapsed={false} indent />}
                </ul>
              )}
            </li>
          )}

          {isAdmin && <NavItem to="/admin" label="Quản trị" icon={GearSix} collapsed={collapsed} />}
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
