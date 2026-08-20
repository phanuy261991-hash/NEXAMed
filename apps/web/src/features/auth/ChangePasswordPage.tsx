import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { PasswordInput } from '../../shared/ui/PasswordInput';
import { changePassword } from './auth.api';
import { useAuthStore } from './auth.store';

/**
 * Bắt buộc đổi mật khẩu lần đầu (mở rộng ADM-01) — `RequireAuth.tsx` chặn điều hướng tới mọi
 * trang khác khi `user.mustChangePassword===true`. Cố ý đứng NGOÀI `AppShell` (không sidebar) —
 * người dùng chưa nên thấy menu khi còn nợ đổi mật khẩu. Cũng dùng được cho đổi mật khẩu tự
 * nguyện sau này (chưa có điểm vào từ menu ở v1 — chỉ đường vào là luồng bắt buộc).
 */
export function ChangePasswordPage() {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await changePassword({ currentPassword, newPassword });
      updateUser({ mustChangePassword: false });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md" noValidate>
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Đổi mật khẩu</h1>
        <p className="mb-6 text-sm text-slate-500">
          {user?.mustChangePassword
            ? 'Tài khoản của bạn yêu cầu đổi mật khẩu trước khi tiếp tục sử dụng hệ thống.'
            : 'Đổi mật khẩu đăng nhập.'}
        </p>

        <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="current-password">
          Mật khẩu hiện tại <span className="text-rose-500">*</span>
        </label>
        <div className="mb-4">
          <PasswordInput id="current-password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" required />
        </div>

        <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="new-password">
          Mật khẩu mới <span className="text-rose-500">*</span>
        </label>
        <div className="mb-4">
          <PasswordInput id="new-password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" required />
        </div>

        {error && (
          <p role="alert" className="mb-4 text-sm text-rose-600">
            {error}
          </p>
        )}

        <Button type="submit" loading={submitting} disabled={newPassword.length < 8} className="w-full">
          Đổi mật khẩu
        </Button>
      </form>
    </div>
  );
}