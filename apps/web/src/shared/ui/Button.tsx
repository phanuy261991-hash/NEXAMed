import type { ButtonHTMLAttributes } from 'react';
import { CircleNotch } from '@phosphor-icons/react';

/**
 * Nút dùng chung — theo .claude/docs/ui-guidelines.md mục 2.1. `variant` thay vì override
 * `className` thô: nối className bằng template literal không giải quyết được xung đột giữa
 * class nền/màu chữ mặc định (`bg-blue-600`/`text-white`) và class override (`bg-white`/
 * `text-slate-700`) — thứ tự thắng trong CSS phụ thuộc thứ tự trong stylesheet đã build, không
 * phải thứ tự trong chuỗi class ở HTML, nên override qua `className` bị chữ trắng trên nền
 * trắng (phát hiện thật khi kiểm bằng trình duyệt ở S2-08, nút "Huỷ" vô hình).
 */
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'add' | 'amber';

const VARIANT_CLASSNAME: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 active:bg-slate-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800',
  // "Thêm dòng vào danh sách" (khác "Lưu"/"Huỷ" — không phải hành động chính của form) — viền đứt
  // nét, đúng khuôn đã dùng ở `ExamTypeFormModal.tsx`/`ReceptionIntakeForm.tsx` trước khi trích
  // xuất vào đây (docs/DECISIONS.md #080).
  add: 'border border-dashed border-blue-400 bg-blue-50 text-blue-600 hover:bg-blue-100',
  // Hành động phụ gắn với trạng thái "đang diễn ra" (khớp màu amber đã dùng cho badge/viền trạng
  // thái "Đang khám" — ví dụ "Tiếp tục khám" ở `ReceptionDoctorQueuePage.tsx`).
  amber: 'bg-white text-amber-700 ring-1 ring-inset ring-amber-300 hover:bg-amber-50 active:bg-amber-100',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: ButtonVariant;
}

export function Button({ loading = false, disabled, children, className = '', variant = 'primary', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASSNAME[variant]} ${className}`}
    >
      {loading && <CircleNotch size={16} weight="bold" className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
