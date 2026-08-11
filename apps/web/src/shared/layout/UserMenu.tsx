import { SignOut } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../features/auth/auth.api';
import { useAuthStore } from '../../features/auth/auth.store';

export function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();

  async function handleLogout() {
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
    <div className="border-t border-slate-800 p-3">
      <p className="truncate text-sm font-medium text-white">{user.fullName}</p>
      <p className="truncate text-xs text-slate-400">@{user.username}</p>
      <button
        type="button"
        onClick={handleLogout}
        className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        <SignOut size={18} weight="regular" aria-hidden="true" />
        Đăng xuất
      </button>
    </div>
  );
}
