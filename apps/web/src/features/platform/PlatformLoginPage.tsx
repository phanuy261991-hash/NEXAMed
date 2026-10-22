import { useState, type FormEvent } from 'react';
import { ShieldCheck } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { PasswordInput } from '../../shared/ui/PasswordInput';
import { WEB_BUILD_ID, WEB_VERSION, formatDisplayVersion } from '../../shared/version/app-version';
import { PlatformApiError, platformLogin, platformVerifyOtp } from './platform.api';
import { usePlatformSession } from './platform.store';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

/** Đăng nhập người vận hành: bước 1 tên đăng nhập + mật khẩu, bước 2 mã xác thực 6 số từ ứng dụng OTP (docs/DECISIONS.md #237). Mỗi bước là một `<form>` — Enter xác nhận. */
export function PlatformLoginPage() {
  const setSession = usePlatformSession((s) => s.setSession);
  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageOf = (err: unknown) => (err instanceof PlatformApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');

  async function handlePassword(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await platformLogin(username, password);
      setMfaToken(result.mfaToken);
      setCode('');
      setStep('otp');
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtp(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await platformVerifyOtp(mfaToken, code.trim());
      setSession(session.accessToken, session.operator);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md">
        <span className="mb-3 inline-block rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold tracking-widest text-slate-900">NỀN TẢNG</span>
        <h1 className="mb-6 text-xl font-semibold text-slate-900">Đăng nhập khu quản trị</h1>

        {step === 'password' ? (
          <form onSubmit={handlePassword} noValidate>
            <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="op-username">
              Tên đăng nhập <span className="text-rose-500">*</span>
            </label>
            <input id="op-username" autoComplete="username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} className={`${inputClassName} mb-4`} />
            <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="op-password">
              Mật khẩu <span className="text-rose-500">*</span>
            </label>
            <div className="mb-4">
              <PasswordInput id="op-password" value={password} onChange={setPassword} autoComplete="current-password" required />
            </div>
            {error && (
              <p role="alert" className="mb-4 text-sm font-semibold text-rose-600">
                {error}
              </p>
            )}
            <Button type="submit" loading={submitting} disabled={!username.trim() || !password} className="w-full">
              Tiếp tục
            </Button>
          </form>
        ) : (
          <form onSubmit={handleOtp} noValidate>
            <p className="mb-4 flex items-start gap-2 text-sm font-medium text-slate-600">
              <ShieldCheck size={18} weight="regular" className="mt-0.5 flex-none text-blue-600" aria-hidden="true" />
              Nhập mã 6 số trong ứng dụng xác thực trên điện thoại của bạn.
            </p>
            <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor="op-otp">
              Mã xác thực <span className="text-rose-500">*</span>
            </label>
            <input
              id="op-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={`${inputClassName} mb-4 text-center text-lg tracking-[0.4em] tabular-nums`}
            />
            {error && (
              <p role="alert" className="mb-4 text-sm font-semibold text-rose-600">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setStep('password');
                  setError(null);
                }}
              >
                Quay lại
              </Button>
              <Button type="submit" loading={submitting} disabled={code.length !== 6} className="flex-1">
                Đăng nhập
              </Button>
            </div>
          </form>
        )}
      </div>
      <p className="mt-4 text-center text-xs font-medium tabular-nums text-slate-500">NEXAMed {formatDisplayVersion(WEB_VERSION, WEB_BUILD_ID)}</p>
    </div>
  );
}
