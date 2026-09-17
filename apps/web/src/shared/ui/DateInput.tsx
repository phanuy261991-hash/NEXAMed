import { useEffect, useRef, useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';

/** ISO `yyyy-mm-dd` -> hiển thị `dd/mm/yyyy`. Rỗng nếu đầu vào rỗng/sai dạng. */
function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

/** Áp mặt nạ khi gõ — chỉ giữ số, tự chèn "/" sau ngày/tháng, tối đa 8 chữ số. */
function applyMask(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
}

/** `dd/mm/yyyy` đã gõ ĐỦ -> ISO `yyyy-mm-dd`, hoặc `null` nếu chưa đủ/không phải ngày thật (vd 31/02). */
function displayToIso(display: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Ô nhập ngày hiển thị CỐ ĐỊNH `dd/mm/yyyy` (yêu cầu chủ dự án, 16/09/2026) — thay `<input
 * type="date">` gốc trên TOÀN APP vì định dạng hiển thị của nó do trình duyệt/hệ điều hành quyết
 * định, không ép được bằng CSS/JS thuần (đã ghi nhận sẵn ở `shared/format/date.ts` — "chưa xây ở
 * v1", nay xây). Gõ tay có mặt nạ tự chèn "/"; nút lịch dùng `showPicker()` (Chrome 99+ — đúng
 * trình duyệt DUY NHẤT dự án verify qua Playwright, không cần fallback trình duyệt khác) mở lịch
 * chọn NGÀY GỐC của trình duyệt neo đúng vị trí ô, không cần đọc text bên trong ô ẩn.
 *
 * `value`/`onChange` giữ NGUYÊN hợp đồng ISO `yyyy-mm-dd` như `<input type="date">` cũ — thay tại
 * chỗ gọi không cần sửa state/logic submit ở nơi dùng.
 */
export function DateInput({
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  /** Cỡ gọn cho thanh lọc (`px-2.5 py-1.5 text-[13px]`, đúng khuôn các ô lọc ngày hiện có) — mặc
   * định cỡ form thường (`py-2 text-[15px]`), cùng tinh thần prop `dense` của `Textarea.tsx`. */
  dense = false,
  className = '',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  dense?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(() => isoToDisplay(value));
  const [focused, setFocused] = useState(false);
  const hiddenRef = useRef<HTMLInputElement>(null);

  // Đồng bộ lại từ `value` khi KHÔNG đang gõ dở (tránh nhảy con trỏ giữa chừng).
  useEffect(() => {
    if (!focused) setText(isoToDisplay(value));
  }, [value, focused]);

  function commitText(nextText: string) {
    setText(nextText);
    if (nextText === '') {
      onChange('');
      return;
    }
    const iso = displayToIso(nextText);
    if (iso) onChange(iso);
  }

  function handleBlur() {
    setFocused(false);
    // Gõ dở/không hợp lệ lúc rời ô -> quay về giá trị hợp lệ gần nhất, không giữ chuỗi rác.
    if (text !== '' && displayToIso(text) === null) setText(isoToDisplay(value));
  }

  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        disabled={disabled}
        required={required}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onChange={(e) => commitText(applyMask(e.target.value))}
        className={`w-full rounded-md border border-slate-300 pl-3 pr-9 font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-800 ${dense ? 'py-1.5 text-[13px]' : 'py-2 text-[15px]'}`}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => hiddenRef.current?.showPicker?.()}
        aria-label="Mở lịch chọn ngày"
        className="absolute right-0 top-0 flex h-full w-8 items-center justify-center text-slate-400 hover:text-blue-600 disabled:opacity-50"
      >
        <CalendarBlank size={15} weight="bold" aria-hidden="true" />
      </button>
      <input
        ref={hiddenRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        value={value}
        onChange={(e) => commitText(isoToDisplay(e.target.value))}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
    </div>
  );
}
