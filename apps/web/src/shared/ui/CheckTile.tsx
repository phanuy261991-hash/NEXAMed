import { Check } from '@phosphor-icons/react';

/**
 * Ô tích chọn dạng thẻ — dùng cho danh sách lựa chọn NGẮN, chọn được NHIỀU mục cùng lúc (ví dụ "Hướng điều trị": Kê đơn thuốc / Chuyển viện / Hẹn tái khám / Cấp cứu).
 * Không dùng checkbox mặc định của trình duyệt (ui-guidelines mục 4.6): ô vuông tự vẽ, trạng thái đã chọn theo token "Lựa chọn" (`brand-teal`, mục 2.1);
 * `tone="danger"` đổi màu đã chọn sang đỏ cho mục cần nổi bật (ví dụ Cấp cứu). `disabled` = chỉ xem (giữ nguyên màu đã chọn, không có hiệu ứng rê chuột).
 */
export function CheckTile({
  id,
  label,
  checked,
  onChange,
  disabled = false,
  tone = 'default',
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  const checkedColors = tone === 'danger' ? 'border-rose-600 bg-rose-600 text-white' : 'border-brand-teal bg-brand-teal text-white';
  const idleColors = disabled ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:bg-brand-teal-tint';
  return (
    <label
      htmlFor={id}
      className={`flex select-none items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors ${checked ? checkedColors : idleColors} ${
        disabled ? 'cursor-default' : 'cursor-pointer'
      }`}
    >
      <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden="true"
        className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 ${
          checked ? 'border-white bg-white' : 'border-slate-300 bg-white'
        }`}
      >
        {checked && <Check size={12} weight="bold" className={tone === 'danger' ? 'text-rose-600' : 'text-brand-teal'} />}
      </span>
      {label}
    </label>
  );
}
