import type { Icon } from '@phosphor-icons/react';
import { X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/**
 * Tiêu đề modal Thêm/Sửa DÙNG CHUNG (chốt 2026-09-05, chủ dự án phản hồi trực tiếp "nhìn phẳng,
 * không nổi bật") — badge icon tròn màu thương hiệu + tiêu đề đậm + phụ đề dạng pill (thay dòng
 * chữ xám nhạt cũ). Áp dụng cho MỌI modal Thêm/Sửa trong `apps/web` — không viết header tay riêng
 * từng nơi nữa (`.claude/docs/ui-guidelines.md` mục 4.1g).
 */
export function ModalHeader({
  icon: IconComponent,
  title,
  subtitle,
  right,
  onClose,
}: {
  icon: Icon;
  title: string;
  /** Ví dụ "Danh mục: Dân tộc" — hiện dạng pill xám thay vì dòng chữ nhạt cũ. */
  subtitle?: string;
  /** Nội dung phụ bên phải (ví dụ badge "Mã: CA00001" — mã tự sinh, chỉ đọc) — đặt trước nút đóng. */
  right?: ReactNode;
  /** Nút X đóng modal ở góc phải — tuỳ chọn, dùng khi modal không có nút "Huỷ" ở vị trí quen thuộc. */
  onClose?: () => void;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-blue-600 text-white">
          <IconComponent size={20} weight="fill" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-[17px] font-bold text-slate-900">{title}</h2>
          {subtitle && (
            <span className="mt-1 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">{subtitle}</span>
          )}
        </div>
      </div>
      <div className="flex flex-none items-center gap-2">
        {right}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
