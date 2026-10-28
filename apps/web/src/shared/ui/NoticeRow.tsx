import type { ReactNode } from 'react';
import { WarningCircle } from '@phosphor-icons/react';

/**
 * Dòng nhắc PHẲNG có hành động (ví dụ "Ca ngày 26/10 chưa được đóng" + nút "Đóng ca ngày 26/10"): không nền, không khung bo, không vạch màu bên cạnh
 * (chủ dự án chê khung hổ phách bo góc có vạch dày bên trái là "AI look", 28/10/2026). Màu chỉ nằm ở biểu tượng và phần chữ nhấn; ngăn cách với nội dung
 * bên dưới bằng MỘT đường kẻ mảnh. `action` là nút `Button` do nơi gọi truyền (thường `variant="amber"`).
 */
export function NoticeRow({ title, children, action, label }: { title: string; children?: ReactNode; action?: ReactNode; label?: string }) {
  return (
    <div role="region" aria-label={label ?? title} className="flex flex-shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 px-1 pb-2.5">
      <p className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
        <WarningCircle size={18} weight="fill" className="flex-shrink-0 text-amber-600" aria-hidden="true" />
        <span>
          <span className="font-semibold text-amber-800">{title}</span>
          {children && <> {children}</>}
        </span>
      </p>
      {action}
    </div>
  );
}
