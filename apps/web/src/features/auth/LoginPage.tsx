import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Lock, LockKey, Warning, WifiSlash } from '@phosphor-icons/react';
import { useAppConfig } from '../../app/AppConfigProvider';
import { Button } from '../../shared/ui/Button';
import { WEB_BUILD_ID, WEB_VERSION, formatDisplayVersion } from '../../shared/version/app-version';
import { login } from './auth.api';
import { useAuthStore } from './auth.store';
import { LoginBackdrop } from './LoginBackdrop';
import { LoginPasswordField, LoginUsernameField } from './LoginFields';
import { classifyLoginError, formatCountdown, secondsRemaining, type LoginFailure } from './login-error';

/**
 * Màn đăng nhập — thiết kế lại theo mockup đã duyệt 16/10/2026: màn hình lớn là một CỬA SỔ chia đôi (panel thương hiệu teal nhạt + form) nổi giữa nền biểu tượng y khoa lơ lửng;
 * điện thoại là màn đầy đủ không nền, header gọn chỉ logo + tên + "Phần mềm quản lý phòng khám". Khung lỗi theo `.claude/docs/ui-guidelines.md` mục 4.3 (inline, viền màu). Khoá tạm có đếm lùi
 * (docs/DECISIONS.md #239). Chưa làm: ảnh nền do phòng khám tự tải lên (mockup câu 7, làm sau).
 */
const JOURNEY: ReadonlyArray<{ title: string; hint: string }> = [
  { title: 'Đặt lịch', hint: 'Lịch hẹn theo bác sĩ, không trùng giờ' },
  { title: 'Tiếp nhận', hint: 'Hàng đợi khám và sinh hiệu' },
  { title: 'Khám bệnh', hint: 'Hồ sơ bệnh án, chẩn đoán theo ICD-10' },
  { title: 'Kê đơn', hint: 'Đơn thuốc, in đơn ngay tại phòng khám' },
  { title: 'Thu ngân', hint: 'Phiếu thu, tổng kết cuối ngày' },
];

const ALERT_TONE = {
  rose: 'border-rose-300 bg-rose-50 text-rose-700',
  amber: 'border-amber-300 bg-amber-50 text-amber-800',
} as const;

function AlertBox({ tone, icon, children }: { tone: keyof typeof ALERT_TONE; icon: ReactNode; children: ReactNode }) {
  return (
    <div role="alert" className={`mb-4 flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm font-semibold leading-snug ${ALERT_TONE[tone]}`}>
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function LoginPage() {
  const config = useAppConfig();
  const company = config.company;
  const suspended = company?.suspended === true;
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const [emptyHint, setEmptyHint] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const usernameRef = useRef<HTMLInputElement>(null);

  // Keyboard-first: lễ tân gõ ngay khi mở trang. Điện thoại không tự focus để bàn phím không bật che mất màn hình.
  useEffect(() => {
    if (window.matchMedia('(min-width: 900px) and (min-height: 560px)').matches) usernameRef.current?.focus();
  }, []);

  // Đếm lùi khoá tạm: tick mỗi giây chỉ khi đang khoá. Mốc kết thúc tính từ số giây TƯƠNG ĐỐI máy chủ trả (không phụ thuộc lệch đồng hồ).
  const lockEndsAt = failure?.kind === 'locked' ? failure.endsAt : null;
  useEffect(() => {
    if (!lockEndsAt) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [lockEndsAt]);
  const lockRemaining = lockEndsAt ? secondsRemaining(lockEndsAt, now) : 0;
  const locked = failure?.kind === 'locked' && lockRemaining > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || suspended || submitting) return;
    if (username.trim() === '' || password === '') {
      setEmptyHint(true);
      setFailure(null);
      return;
    }
    setEmptyHint(false);
    setSubmitting(true);
    setFailure(null);
    try {
      const result = await login(config.tenantId, username, password);
      setSession(result.accessToken, result.user);
      navigate('/', { replace: true });
    } catch (err) {
      setFailure(classifyLoginError(err));
    } finally {
      setSubmitting(false);
    }
  }

  function renderFailure() {
    if (emptyHint) {
      return (
        <AlertBox tone="amber" icon={<Warning size={18} weight="bold" aria-hidden="true" />}>
          Nhập tên đăng nhập và mật khẩu.
        </AlertBox>
      );
    }
    if (!failure) return null;
    switch (failure.kind) {
      case 'locked':
        return lockRemaining > 0 ? (
          <AlertBox tone="amber" icon={<Lock size={18} weight="bold" aria-hidden="true" />}>
            {/* Đọc cho trình đọc màn hình MỘT lần (số phút cố định), đồng hồ chạy bị ẩn để không đọc lại mỗi giây. */}
            <span className="sr-only">Tài khoản bị khoá tạm thời, thử lại sau {failure.minutes} phút.</span>
            <span aria-hidden="true">
              Tài khoản bị khoá. <span className="whitespace-nowrap">Thử lại sau <span className="font-semibold tabular-nums">{formatCountdown(lockRemaining)}</span></span>
            </span>
          </AlertBox>
        ) : (
          <AlertBox tone="amber" icon={<Lock size={18} weight="bold" aria-hidden="true" />}>
            Đã hết thời gian khoá. Bạn có thể đăng nhập lại.
          </AlertBox>
        );
      case 'permanent':
        return (
          <AlertBox tone="rose" icon={<LockKey size={18} weight="bold" aria-hidden="true" />}>
            {failure.message}
          </AlertBox>
        );
      case 'network':
        return (
          <AlertBox tone="rose" icon={<WifiSlash size={18} weight="bold" aria-hidden="true" />}>
            {failure.message}
            <div className="mt-2">
              <Button type="submit" variant="dangerGhost" className="!px-3 !py-1 text-[13px]" loading={submitting}>
                Thử lại
              </Button>
            </div>
          </AlertBox>
        );
      case 'rate':
      case 'suspended':
        return (
          <AlertBox tone="amber" icon={<Warning size={18} weight="bold" aria-hidden="true" />}>
            {failure.message}
          </AlertBox>
        );
      default:
        return (
          <AlertBox tone="rose" icon={<Warning size={18} weight="bold" aria-hidden="true" />}>
            {failure.message}
          </AlertBox>
        );
    }
  }

  const version = `NEXAMed ${formatDisplayVersion(WEB_VERSION, WEB_BUILD_ID)}`;

  return (
    <div className="relative flex min-h-dvh justify-center bg-white min-[480px]:bg-slate-100 desktop:items-center desktop:p-10 [@media(max-height:720px)]:desktop:p-4">
      <LoginBackdrop />

      <div className="relative z-10 grid w-full max-w-[480px] grid-rows-[auto_1fr] bg-white [--login-w:1000px] [--login-h:600px] min-[1920px]:[--login-w:1120px] min-[1920px]:[--login-h:660px] min-[2560px]:[--login-w:1280px] min-[2560px]:[--login-h:720px] desktop:min-h-[var(--login-h)] desktop:max-w-[var(--login-w)] desktop:grid-cols-[minmax(340px,42%)_1fr] desktop:grid-rows-1 desktop:overflow-hidden desktop:rounded-xl desktop:shadow-xl">
        {/* Panel thương hiệu: điện thoại = header gọn (logo + tên + một dòng mô tả); màn lớn = logo, câu giới thiệu, hành trình 5 bước. */}
        <aside className="grid grid-cols-[auto_1fr] items-center gap-x-3 bg-brand-teal-tint px-6 py-[18px] desktop:flex desktop:flex-col desktop:items-stretch desktop:gap-8 desktop:px-10 desktop:py-9">
          <div className="contents desktop:flex desktop:items-center desktop:gap-3">
            <div className="row-span-2 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold tracking-wide text-white desktop:row-span-1 desktop:h-9 desktop:w-9">
              NX
            </div>
            <span className="self-end text-[17px] font-semibold leading-tight text-slate-900 desktop:self-auto desktop:text-lg">NEXAMed</span>
          </div>
          <p className="col-start-2 self-start text-[13px] font-medium leading-tight text-slate-700 desktop:hidden">Phần mềm quản lý phòng khám</p>

          <p className="hidden max-w-[24ch] text-[22px] font-semibold leading-snug tracking-tight text-slate-900 desktop:block">
            Quản lý phòng khám từ lúc đặt lịch đến lúc thu tiền
          </p>

          <div className="hidden flex-1 desktop:block">
            <p className="mb-3.5 text-xs font-semibold uppercase tracking-wider text-slate-700">Một lượt khám đi qua</p>
            <ol>
              {JOURNEY.map((step, index) => (
                <li key={step.title} className="relative grid grid-cols-[20px_1fr] gap-3.5 pb-[18px] last:pb-0">
                  {index < JOURNEY.length - 1 && <span className="absolute -bottom-0.5 left-[9.5px] top-5 w-px bg-brand-teal/45" aria-hidden="true" />}
                  <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-teal text-white" aria-hidden="true">
                    <Check size={12} weight="bold" />
                  </span>
                  <div>
                    <b className="block text-[15px] font-semibold text-slate-900">{step.title}</b>
                    <span className="mt-0.5 block text-[13px] leading-snug text-slate-700">{step.hint}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Phiên bản của gói web đang chạy (docs/DECISIONS.md #236) — nhân viên đọc cho bộ phận hỗ trợ khi báo lỗi trước cả khi đăng nhập được. */}
          <p className="hidden text-xs tabular-nums text-slate-700 desktop:block">{version}</p>
        </aside>

        <main className="flex flex-col items-center px-6 pb-[calc(18px+env(safe-area-inset-bottom,0px))] pt-6 desktop:px-12 desktop:pb-6 desktop:pt-7">
          {/* Chế độ SaaS (#237): tên miền phụ + tên công ty nhận từ địa chỉ truy cập. */}
          {company && (
            <div className="mb-3 hidden w-full max-w-[420px] justify-end desktop:flex">
              <span className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{window.location.host}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="mb-auto mt-6 w-full max-w-[420px] desktop:my-auto">
            {company && (
              <div className="mb-4 border-b border-slate-300 pb-3.5">
                <span className="mb-2 inline-block rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 desktop:hidden">{window.location.host}</span>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Phòng khám</p>
                <p className="text-lg font-semibold text-slate-900">{company.name}</p>
              </div>
            )}

            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 desktop:text-[26px]">Đăng nhập</h1>
            <p className="mb-5 mt-1.5 text-sm text-slate-600">Dùng tài khoản do quản trị viên phòng khám cấp.</p>

            {suspended && (
              <AlertBox tone="amber" icon={<Warning size={18} weight="bold" aria-hidden="true" />}>
                Công ty đang tạm ngưng sử dụng. Vui lòng liên hệ nhà cung cấp để được hỗ trợ.
              </AlertBox>
            )}

            <div className="mb-4 flex flex-col gap-4">
              <LoginUsernameField id="username" value={username} onChange={setUsername} disabled={submitting} inputRef={usernameRef} />
              <LoginPasswordField id="password" value={password} onChange={setPassword} disabled={submitting} />
            </div>

            <div aria-live="polite">{renderFailure()}</div>

            <Button type="submit" loading={submitting} disabled={suspended || locked} className="h-12 w-full desktop:h-[46px]">
              Đăng nhập
            </Button>

            <p className="mt-4 text-[13px] leading-relaxed text-slate-600">Quên mật khẩu? Liên hệ quản trị viên để được đặt lại.</p>
          </form>

          <div className="mt-auto hidden w-full max-w-[420px] border-t border-slate-200 pt-3 text-xs text-slate-600 desktop:block">Nhấn Enter để đăng nhập</div>
          <p className="mt-2 text-center text-xs tabular-nums text-slate-600 desktop:hidden">{version}</p>
        </main>
      </div>
    </div>
  );
}
