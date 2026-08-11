import { GearSix, House, type Icon } from '@phosphor-icons/react';
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/auth.store';
import { UserMenu } from './UserMenu';

/** Vai trò được thấy mục Quản trị — theo lựa chọn đã chốt ở S1-08 (kết hợp luồng nghiệp vụ + vai trò). */
const ADMIN_ROLES = ['clinic_admin', 'system_admin'];

interface NavItemProps {
  to: string;
  label: string;
  icon: Icon;
  end?: boolean;
}

function NavItem({ to, label, icon: IconComponent, end }: NavItemProps) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
          }`
        }
      >
        {({ isActive }) => (
          <>
            <IconComponent size={20} weight={isActive ? 'fill' : 'regular'} aria-hidden="true" />
            {label}
          </>
        )}
      </NavLink>
    </li>
  );
}

/**
 * Sidebar cố định trái, không collapse ẩn hoàn toàn — theo docs/design/UI_GUIDELINE.md mục 5.
 * Chỉ hiện mục đã có backend thật: Tổng quan (Dashboard) luôn hiện; Quản trị chỉ hiện với
 * clinic_admin/system_admin. Đặt lịch/Tiếp nhận/Khám bệnh/Kê đơn chưa hiện — thêm dần đúng
 * sprint có module tương ứng (S2-S4).
 */
export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.roles.some((role) => ADMIN_ROLES.includes(role)) ?? false;

  return (
    <nav className="flex h-full flex-col justify-between" aria-label="Điều hướng chính">
      <ul className="flex flex-col gap-1 p-3">
        <NavItem to="/" label="Tổng quan" icon={House} end />
        {isAdmin && <NavItem to="/admin" label="Quản trị" icon={GearSix} />}
      </ul>
      <UserMenu />
    </nav>
  );
}
