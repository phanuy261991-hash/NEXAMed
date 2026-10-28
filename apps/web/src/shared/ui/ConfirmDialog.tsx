import { useEffect, type ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { ModalHeader } from './ModalHeader';

/**
 * Hộp thoại XÁC NHẬN dùng chung (ngưng/ẩn/xoá/mở khoá/từ chối...) — thay kiểu cũ "tiêu đề nhỏ + đoạn chữ xám dài + 2 nút" mà chủ dự án phản hồi "AI look, nhiều chữ" (16/10/2026,
 * `.claude/docs/ui-guidelines.md` mục 15b). Bố cục: tiêu đề modal dùng chung (`ModalHeader`: biểu tượng + tên hành động + nút đóng) → các dòng thông tin có đường kẻ ("Chi nhánh | Quận 7")
 * → ô nhập bổ sung (nếu có, ví dụ lý do) → lỗi inline → chú thích ngắn bên trái + nút bên phải. Mỗi chữ phải có việc: tiêu đề là HÀNH ĐỘNG ngắn, hậu quả gói trong MỘT dòng `note`.
 *
 * `actions` do nơi gọi truyền (thường `Huỷ` + nút chính với mutation riêng) để giữ nguyên logic từng màn hình; component chỉ lo vỏ, bố cục, Esc để đóng và khung lỗi.
 */
export function ConfirmDialog({
  icon,
  tone = 'primary',
  size = 'sm',
  title,
  rows,
  note,
  error,
  children,
  actions,
  onClose,
}: {
  icon: Icon;
  /** `danger` = huỷ/xoá/ngưng (biểu tượng đỏ); mặc định xanh thương hiệu. */
  tone?: 'primary' | 'danger';
  /** `sm` (384px, mặc định) cho hộp ít chữ; `md` (560px) khi dòng thông tin dài (ví dụ liệt kê nhiều ngày). */
  size?: 'sm' | 'md';
  title: string;
  /** Thông tin ngắn dạng `nhãn | giá trị` có đường kẻ (đối tượng bị tác động, tình trạng...). Giá trị đậm, `sub` là dòng xám nhỏ bên dưới. */
  rows?: Array<{ label: string; value: ReactNode; sub?: string }>;
  /** Hậu quả/ghi chú trong MỘT câu ngắn, hiện nhỏ dưới phần thông tin. */
  note?: string;
  error?: string | null;
  /** Ô nhập bổ sung giữa phần thông tin và nút (ví dụ ô "Lý do"). */
  children?: ReactNode;
  /** Nút bên phải (Huỷ + nút chính). */
  actions: ReactNode;
  onClose: () => void;
}) {
  // Esc đóng hộp thoại — thao tác quen thuộc, trước đây các hộp xác nhận không có.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full rounded-xl bg-white p-5 shadow-xl ${size === 'md' ? 'max-w-[560px]' : 'max-w-sm'}`}>
        <ModalHeader icon={icon} tone={tone} title={title} onClose={onClose} />

        {rows && rows.length > 0 && (
          <dl className="divide-y divide-slate-100 border-b border-slate-100 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="flex-none text-slate-500">{row.label}</dt>
                <dd className="min-w-0 text-right">
                  <span className="block wrap-break-word font-semibold text-slate-900">{row.value}</span>
                  {row.sub && <span className="block truncate text-xs text-slate-500">{row.sub}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {note && <p className="mt-2.5 text-xs text-slate-500">{note}</p>}

        {children && <div className="mt-3.5">{children}</div>}

        {error && (
          <p role="alert" className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}
