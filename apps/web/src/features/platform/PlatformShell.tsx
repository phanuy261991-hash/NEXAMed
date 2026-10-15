import type { ReactNode } from 'react';
import { ClockCounterClockwise, SignOut, UsersThree } from '@phosphor-icons/react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { getInitials } from '../../shared/format/initials';
import { WEB_BUILD_ID, WEB_VERSION, formatDisplayVersion } from '../../shared/version/app-version';
import { usePlatformSession } from './platform.store';

const NAV_ITEMS = [
  { to: '/', label: 'Khách hàng', icon: UsersThree, end: true },
  { to: '/audit', label: 'Nhật ký vận hành', icon: ClockCounterClockwise, end: false },
] as const;

function breadcrumbFor(pathname: string): string[] {
  if (pathname === '/audit') return ['Nhật ký vận hành'];
  if (pathname === '/tenants/new') return ['Khách hàng', 'Thêm công ty'];
  if (pathname.startsWith('/tenants/')) return ['Khách hàng', 'Chi tiết công ty'];
  return ['Khách hàng'];
}

/** Khung khu quản trị nền tảng: thanh bên tối có nhãn hổ phách "NỀN TẢNG" (không lẫn với giao diện phòng khám), thanh trên có breadcrumb + người vận hành + đăng xuất. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const operator = usePlatformSession((s) => s.operator);
  const clear = usePlatformSession((s) => s.clear);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const crumbs = breadcrumbFor(pathname);

  function handleLogout() {
    clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-dvh bg-slate-50">
      <aside className="flex w-56 flex-none flex-col bg-slate-900 px-2.5 py-4 text-slate-300">
        <Link to="/" className="px-2.5 text-base font-extrabold text-white">
          NEXAMed
        </Link>
        <span className="mx-2.5 mb-4 mt-1 self-start rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold tracking-widest text-slate-900">NỀN TẢNG</span>
        <nav className="flex flex-col gap-0.5" aria-label="Menu nền tảng">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium ${isActive ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`
              }
            >
              <item.icon size={16} weight="regular" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <p className="mt-auto px-2.5 text-xs font-medium tabular-nums text-slate-500">v{formatDisplayVersion(WEB_VERSION, WEB_BUILD_ID)}</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[52px] items-center justify-between gap-3 border-b border-slate-200 bg-white px-5">
          <nav aria-label="Vị trí" className="flex items-center gap-1.5 text-sm text-slate-500">
            <span>Nền tảng</span>
            {crumbs.map((crumb, index) => (
              <span key={crumb} className="flex items-center gap-1.5">
                <span className="text-slate-300">›</span>
                <span className={index === crumbs.length - 1 ? 'rounded-md bg-blue-50 px-2 py-0.5 font-semibold text-blue-700' : undefined}>{crumb}</span>
              </span>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>
              Xin chào, <span className="font-bold text-slate-900">{operator?.fullName}</span> (vận hành)
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-blue-50 text-xs font-bold text-blue-600" aria-hidden="true">
              {getInitials(operator?.fullName ?? '')}
            </span>
            <button type="button" onClick={handleLogout} aria-label="Đăng xuất" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
              <SignOut size={16} aria-hidden="true" />
              Đăng xuất
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
