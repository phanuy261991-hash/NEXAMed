import { useState, type KeyboardEvent, type Ref } from 'react';
import { ArrowFatUp, Eye, EyeSlash, Lock, User } from '@phosphor-icons/react';

/**
 * Hai ô nhập của màn đăng nhập — kiểu "nền xám nhạt" đã duyệt qua mockup 16/10/2026: không viền lúc nghỉ, chuyển trắng + viền/vòng sáng xanh khi gõ, biểu tượng đầu ô, bo 8px,
 * cao 48px trên điện thoại (chữ 16px để iOS không tự phóng to) và 46px trên màn hình lớn. Nhãn vẫn nằm TRÊN ô (`.claude/docs/ui-guidelines.md` mục 4.1c).
 * Chỉ dùng ở màn đăng nhập nên đặt cạnh `LoginPage` — không thay `PasswordInput` dùng chung (kiểu viền cũ của các form nghiệp vụ).
 */
const INPUT_CLASS =
  'peer h-12 w-full rounded-lg border-[1.5px] border-transparent bg-slate-100 pl-[42px] text-base font-semibold text-slate-900 transition-colors hover:bg-slate-200/70 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-600/15 disabled:bg-slate-50 disabled:text-slate-500 desktop:h-[46px] desktop:text-[15px]';
const ICON_CLASS = 'pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-slate-500 peer-focus:text-blue-600';

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-slate-800">
      {children} <span className="text-rose-500">*</span>
    </label>
  );
}

export function LoginUsernameField({
  id,
  value,
  onChange,
  disabled,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>Tên đăng nhập</FieldLabel>
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={INPUT_CLASS}
        />
        <User size={18} weight="regular" className={ICON_CLASS} aria-hidden="true" />
      </div>
    </div>
  );
}

export function LoginPasswordField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  // Caps Lock đọc từ phím vừa bấm — chỉ biết được khi người dùng gõ phím, nên nhắc từ lúc gõ ký tự đầu tiên.
  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));

  return (
    <div>
      <FieldLabel htmlFor={id}>Mật khẩu</FieldLabel>
      <div className="relative">
        <input
          id={id}
          name="password"
          type={visible ? 'text' : 'password'}
          autoComplete="current-password"
          enterKeyHint="go"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={trackCaps}
          onKeyUp={trackCaps}
          onBlur={() => setCapsLock(false)}
          disabled={disabled}
          className={`${INPUT_CLASS} pr-[84px]`}
        />
        <Lock size={18} weight="regular" className={ICON_CLASS} aria-hidden="true" />
        {capsLock && (
          <span className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-white" aria-hidden="true">
            CAPS
          </span>
        )}
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:pointer-events-none"
        >
          {visible ? <EyeSlash size={20} weight="regular" aria-hidden="true" /> : <Eye size={20} weight="regular" aria-hidden="true" />}
        </button>
      </div>
      {capsLock && (
        <p role="status" className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-amber-800">
          <ArrowFatUp size={15} weight="bold" aria-hidden="true" />
          Caps Lock đang bật — mật khẩu phân biệt chữ hoa, chữ thường.
        </p>
      )}
    </div>
  );
}
