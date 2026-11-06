import type { ReactNode } from 'react';

/**
 * Khung nội dung có đầu khung (mockup báo cáo điều hành đã duyệt 05/11/2026, dùng lại cho trang Cập nhật phần mềm 06/11/2026): viền mảnh, bóng nhẹ, đầu khung nền xám rất nhạt có tên khung (đậm) và
 * chú thích phải (nhạt). `tone="info"` đổi viền và đầu khung sang xanh nhạt cho khung cần nổi bật (ví dụ "Có phiên bản mới"). `bodyClassName` để nội dung tự quyết lề trong (bảng sát mép,
 * biểu đồ có lề). Nhận dữ liệu qua props để mọi màn hình dùng chung.
 */
export function SectionCard({
  title,
  hint,
  tone = 'default',
  children,
  bodyClassName = '',
}: {
  title: string;
  hint?: string;
  tone?: 'default' | 'info';
  children: ReactNode;
  bodyClassName?: string;
}) {
  const info = tone === 'info';
  return (
    <section aria-label={title} className={`overflow-hidden rounded-lg border bg-white shadow-sm ${info ? 'border-blue-300' : 'border-slate-200'}`}>
      <div className={`flex items-center justify-between gap-3 border-b px-4 py-2.5 ${info ? 'border-blue-100 bg-blue-50' : 'border-slate-100 bg-slate-50'}`}>
        <h2 className={`text-base font-semibold ${info ? 'text-blue-900' : 'text-slate-900'}`}>{title}</h2>
        {hint && <span className="text-[13px] text-slate-600">{hint}</span>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
