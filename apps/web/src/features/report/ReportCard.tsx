import type { ReactNode } from 'react';

/**
 * Khung nội dung của báo cáo điều hành (mockup đã duyệt 05/11/2026): viền mảnh, bóng nhẹ, đầu khung nền xám rất nhạt có tên khung (đậm) và chú thích phải (nhạt). `bodyClassName` để
 * nội dung tự quyết lề trong (bảng sát mép, biểu đồ có lề). Dùng chung cho mọi báo cáo điều hành.
 */
export function ReportCard({ title, hint, children, bodyClassName = '' }: { title: string; hint?: string; children: ReactNode; bodyClassName?: string }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {hint && <span className="text-[12.5px] text-slate-600">{hint}</span>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
