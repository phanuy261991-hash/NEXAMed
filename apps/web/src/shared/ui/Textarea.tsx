import type { TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  /** Form nhiều ô ngắn trong cùng 1 khung (ví dụ "Thông tin khám lâm sàng") — chữ/khoảng đệm nhỏ hơn ~50%. */
  dense?: boolean;
}

/**
 * Ô nhập nhiều dòng dùng chung — trích từ mẫu `<textarea className="w-full rounded-md border...">`
 * đã lặp lại lần 2 (`ReceptionIntakeForm.tsx`, `AppointmentDetailPanel.tsx`), nay lần thứ 3 ở màn
 * hình khám — đúng ngưỡng trích xuất theo CLAUDE.md. Token giá trị đậm/nhãn nhạt theo
 * .claude/docs/ui-guidelines.md mục 4.1c.
 */
export function Textarea({ id, label, required, dense = false, className = '', ...rest }: TextareaProps) {
  return (
    <div>
      <label htmlFor={id} className={`mb-1 block font-medium text-slate-500 ${dense ? 'text-[11px]' : 'text-xs'}`}>
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </label>
      <textarea
        id={id}
        required={required}
        className={`w-full rounded-md border border-slate-300 font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
          dense ? 'px-2 py-1.5 text-[13px]' : 'px-3 py-2 text-[15px]'
        } ${className}`}
        {...rest}
      />
    </div>
  );
}