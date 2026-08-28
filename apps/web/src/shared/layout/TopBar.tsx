import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { CaretRight, House, SignOut } from '@phosphor-icons/react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import { logout } from '../../features/auth/auth.api';
import { useAuthStore } from '../../features/auth/auth.store';
import { useBreadcrumbItems } from './breadcrumb.context';

/**
 * Lazy-load — dù chỉ hiện đúng ở màn hình khám (`/encounters/:id`), `TopBar` vẫn render trên MỌI
 * trang (không tự lazy như route ở `router.tsx`), nên phải tự lazy import `DoctorQueueButton`
 * (kéo theo toàn bộ phụ thuộc module `reception` — queries/API/queue-card...) để không đẩy các
 * phụ thuộc đó vào chunk khởi động. Đã đo thật: main chunk tăng từ 448.98 kB lên 499.58 kB nếu
 * import tĩnh, vi phạm ngưỡng ≤500 kB đã chốt (`.claude/docs/coding-standards.md` mục "Hiệu suất",
 * #073).
 */
const DoctorQueueButton = lazy(() =>
  import('../../features/reception/DoctorQueueButton').then((m) => ({ default: m.DoctorQueueButton })),
);

/** Bỏ từ không bắt đầu bằng chữ cái (ví dụ hậu tố "(dev)" của tài khoản seed) trước khi lấy viết tắt. */
function getInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (words.length === 0) return '?';
  const picked = words.length >= 2 ? [words[0], words[words.length - 1]] : [words[0]];
  return picked.map((w) => (w ?? '').charAt(0).toUpperCase()).join('');
}

/**
 * Thanh trên cùng — thay thế user card ở chân sidebar (S1-08) và nút "← Quay lại" trên trang con
 * (.claude/docs/ui-guidelines.md mục 8.2, docs/DECISIONS.md #027). Trái: breadcrumb phân cấp.
 * Phải: lời chào + avatar mở dropdown đăng xuất. Không có chuông thông báo (v1 chưa có hệ thống
 * thông báo trong ứng dụng) và không hiện tên khoa (`/auth/me` chưa trả trường này) — cả hai đã
 * hỏi và chốt bỏ.
 */
export function TopBar() {
  const items = useBreadcrumbItems();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();
  // "Hàng chờ" CHỈ hiện ở màn hình khám (`/encounters/:id`), CHỈ vai trò "Bác sĩ" (không cả
  // `clinic_admin`) — theo yêu cầu chủ dự án, không phải mọi trang/mọi vai trò quản lý được.
  const isOnEncounterPage = useMatch('/encounters/:id') !== null;
  const isDoctor = user?.roles.includes('doctor') ?? false;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  async function handleLogout() {
    setMenuOpen(false);
    try {
      await logout();
    } finally {
      clear();
      navigate('/login', { replace: true });
    }
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
        <Link
          to="/"
          aria-label="Về Tổng quan"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <House size={15} weight="regular" aria-hidden="true" />
        </Link>

        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <span key={`${item.label}-${index}`} className="flex items-center gap-1">
              <CaretRight size={11} weight="bold" className="text-slate-300" aria-hidden="true" />
              {!isLast && item.to ? (
                <Link
                  to={item.to}
                  className="rounded-md px-2 py-1 font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={
                    isLast
                      ? 'rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-700'
                      : 'rounded-md px-2 py-1 font-medium text-slate-500'
                  }
                >
                  {item.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="relative flex items-center gap-3" ref={menuRef}>
        {isOnEncounterPage && isDoctor && (
          <Suspense fallback={null}>
            <DoctorQueueButton />
          </Suspense>
        )}
        <span className="text-sm text-slate-500">
          Xin chào, <strong className="font-semibold text-slate-900">{user.displayName ?? user.fullName}</strong>
        </span>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Menu tài khoản"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-blue-50 text-xs font-bold text-blue-600 hover:bg-blue-100"
        >
          {getInitials(user.displayName ?? user.fullName)}
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-11 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-md"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleLogout()}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <SignOut size={16} weight="regular" aria-hidden="true" />
              Đăng xuất
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
