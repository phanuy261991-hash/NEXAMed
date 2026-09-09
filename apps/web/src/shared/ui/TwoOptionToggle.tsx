import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Công tắc trượt 2 lựa chọn (kiểu segmented switch, nền trượt theo lựa chọn đang chọn) — dùng
 * chung cho mọi nơi cần chọn 1-trong-2 gọn trong không gian hẹp (chiết khấu %/Tiền ở
 * `InvoiceDetailPage.tsx`, cả khối tổng lẫn từng dòng dịch vụ — viết ở `shared/ui` với chủ đích
 * tái dùng ngay từ 2 nơi gọi đầu tiên, CLAUDE.md). Hỗ trợ trạng thái CHƯA CHỌN GÌ (`value=null`) —
 * nền trượt chỉ hiện khi đã chọn 1 trong 2, bấm lại đúng ô đang chọn để bỏ chọn (quay về null).
 *
 * Nền trượt đo VỊ TRÍ THẬT của nút đang chọn qua `getBoundingClientRect()` (bug thật đã gặp: tính
 * bằng % + `calc()` để suy vị trí lý thuyết bị lệch khỏi nút thật — sai số cộng dồn từ border/
 * padding/bo tròn số thập phân của trình duyệt, đặc biệt rõ ở nhãn ngắn "%"/"VNĐ") — luôn khớp
 * tuyệt đối với kích thước chữ/khoảng đệm thật đang render, không phụ thuộc suy luận CSS.
 */
export function TwoOptionToggle<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: readonly [{ value: T; label: string }, { value: T; label: string }];
  value: T | null;
  onChange: (next: T | null) => void;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const activeIndex = value === null ? null : options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    if (activeIndex === null) {
      setIndicator(null);
      return;
    }
    const container = containerRef.current;
    const button = buttonRefs.current[activeIndex];
    if (!container || !button) return;
    const containerRect = container.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    setIndicator({ left: buttonRect.left - containerRect.left, width: buttonRect.width });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, options[0].label, options[1].label]);

  return (
    <div ref={containerRef} className={`relative inline-flex items-stretch rounded-full border border-slate-300 bg-slate-100 p-0.5 ${disabled ? 'opacity-40' : ''}`}>
      {indicator && (
        <div
          aria-hidden="true"
          className="absolute inset-y-0.5 rounded-full bg-blue-600 transition-all duration-150 ease-out"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(el) => {
            buttonRefs.current[i] = el;
          }}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === option.value ? null : option.value)}
          className={`relative z-10 flex flex-1 items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold transition-colors disabled:cursor-not-allowed ${
            value === option.value ? 'text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
