import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';

/**
 * Ô nhập số tiền — tự nhảy dấu chấm phân cách hàng nghìn lúc gõ (chốt 2026-08-26, mockup duyệt
 * trước khi code — xem `.claude/docs/ui-guidelines.md` mục 4.1e). Chuẩn `vi-VN` (`1.000.000`),
 * khớp `formatVnd()` đã dùng để HIỂN THỊ (`shared/format/currency.ts`) — component này thêm hành
 * vi tự định dạng lúc NHẬP LIỆU, áp dụng cho MỌI ô nhập tiền phát sinh sau này, không riêng "Đơn
 * giá dịch vụ". Value/onChange là SỐ THẬT (không phải chuỗi đã định dạng) — component tự giữ chuỗi
 * hiển thị + vị trí con trỏ nội bộ, nơi gọi không cần quan tâm định dạng.
 */
export function MoneyInput({
  id,
  value,
  onChange,
  required = false,
  disabled = false,
  placeholder = '0',
  className,
}: {
  id: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCursorRef = useRef<number | null>(null);
  const [text, setText] = useState(value !== undefined ? value.toLocaleString('vi-VN') : '');

  useEffect(() => {
    setText(value !== undefined ? value.toLocaleString('vi-VN') : '');
  }, [value]);

  // Đặt lại vị trí con trỏ SAU khi React vẽ lại chuỗi đã định dạng — không làm vậy thì con trỏ
  // luôn nhảy về cuối ô mỗi lần gõ (bug thật gặp lúc dựng mockup duyệt, sửa bằng kỹ thuật "đếm số
  // chữ số phía trước con trỏ trước khi định dạng, đặt lại đúng vị trí sau khi định dạng").
  useLayoutEffect(() => {
    if (pendingCursorRef.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current);
      pendingCursorRef.current = null;
    }
  }, [text]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const cursorFromEnd = raw.length - (e.target.selectionStart ?? raw.length);
    const digits = raw.replace(/\D/g, '');
    const formatted = digits === '' ? '' : Number(digits).toLocaleString('vi-VN');
    pendingCursorRef.current = Math.max(0, formatted.length - cursorFromEnd);
    setText(formatted);
    onChange(digits === '' ? undefined : Number(digits));
  }

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      value={text}
      onChange={handleChange}
      className={className}
    />
  );
}