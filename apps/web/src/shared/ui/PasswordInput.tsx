import { useState } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';

/**
 * Ô nhập mật khẩu với icon con mắt ẩn/hiện (mở rộng ADM-01, form Thêm tài khoản + Đổi mật khẩu
 * bắt buộc lần đầu) — đặt ở `shared/ui` với chủ đích tái dùng ngay ở cả 2 nơi, theo CLAUDE.md.
 * Cùng token input dữ liệu chuẩn (`.claude/docs/ui-guidelines.md` mục 4.1c).
 */
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  required = false,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        className="w-full rounded-md border border-slate-300 px-3 py-2 pr-10 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 disabled:pointer-events-none"
      >
        {visible ? <EyeSlash size={17} weight="regular" aria-hidden="true" /> : <Eye size={17} weight="regular" aria-hidden="true" />}
      </button>
    </div>
  );
}
