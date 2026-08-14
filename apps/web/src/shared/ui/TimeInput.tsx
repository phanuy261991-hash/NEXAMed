import { useEffect, useState } from 'react';

/**
 * Ô nhập giờ dạng text có mặt nạ `HH:mm` (24 giờ) — thay cho `<input type="time">` gốc vì trình
 * duyệt tự hiển thị theo locale hệ điều hành (có thể ra AM/PM tuỳ máy), không ép được 24h bằng
 * CSS/JS thuần. Giá trị vào/ra vẫn dạng chuỗi `"HH:mm"` giống input gốc — thay tại chỗ không cần
 * đổi state/logic nơi gọi. Gõ tuần tự 4 chữ số (vd `0830` → `08:30`), tự chèn dấu `:` sau 2 số đầu;
 * rời khỏi ô mới chuẩn hoá/giới hạn giờ 0-23, phút 0-59 — gõ dở thì quay về giá trị hợp lệ gần nhất
 * đã có, không chờ Enter.
 */
export function TimeInput({
  id,
  value,
  onChange,
  required = false,
  disabled = false,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  function handleChange(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    const formatted = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
    setText(formatted);
    const match = /^(\d{2}):(\d{2})$/.exec(formatted);
    if (match) {
      const h = Number(match[1]);
      const m = Number(match[2]);
      if (h <= 23 && m <= 59) onChange(formatted);
    }
  }

  function handleBlur() {
    const match = /^(\d{1,2}):?(\d{0,2})$/.exec(text);
    if (!match) {
      setText(value);
      return;
    }
    const h = Math.min(Number(match[1] || 0), 23);
    const m = Math.min(Number(match[2] || 0), 59);
    const normalized = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    setText(normalized);
    onChange(normalized);
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="HH:mm"
      maxLength={5}
      required={required}
      disabled={disabled}
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      className={className}
    />
  );
}