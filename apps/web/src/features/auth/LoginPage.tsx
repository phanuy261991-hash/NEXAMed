import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppConfig } from '../../app/AppConfigProvider';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { WEB_BUILD_ID, WEB_VERSION, formatDisplayVersion } from '../../shared/version/app-version';
import { login } from './auth.api';
import { useAuthStore } from './auth.store';

const inputClassName =
  'mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

export function LoginPage() {
  const config = useAppConfig();
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await login(config.tenantId, username, password);
      setSession(result.accessToken, result.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md" noValidate>
        <h1 className="mb-6 text-xl font-semibold text-slate-900">Đăng nhập NEXAMed</h1>

        <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="username">
          Tên đăng nhập <span className="text-rose-500">*</span>
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClassName}
        />

        <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="password">
          Mật khẩu <span className="text-rose-500">*</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClassName}
        />

        {error && (
          <p role="alert" className="mb-4 text-sm text-rose-600">
            {error}
          </p>
        )}

        <Button type="submit" loading={submitting} className="w-full">
          Đăng nhập
        </Button>
      </form>
      {/* Phiên bản của gói web đang chạy (docs/DECISIONS.md #236) — nhân viên đọc cho bộ phận hỗ trợ khi báo lỗi trước cả khi đăng nhập được. */}
      <p className="mt-4 text-center text-xs font-medium tabular-nums text-slate-500">NEXAMed {formatDisplayVersion(WEB_VERSION, WEB_BUILD_ID)}</p>
    </div>
  );
}
