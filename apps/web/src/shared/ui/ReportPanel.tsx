import type { ReactNode } from 'react';

/**
 * Khung khối của trang báo cáo/Tổng quan: thẻ viền mềm + bóng nhẹ, đầu khối nền nhạt có tiêu đề, dòng phụ và hành động (liên kết "Xem tất cả"...). Kiểu lấy từ trang báo cáo thật
 * (docs/DECISIONS.md #279, `docs/product/reporting-plan.md` mục 11): `rounded-lg border-slate-200 shadow-sm`, đầu khối `bg-slate-50 border-b border-slate-100`.
 * `footer` là dòng tổng cuối khối (nền nhạt, chữ đậm). Không chứa logic nghiệp vụ — nhận nội dung qua props.
 */
export function ReportPanel({
  title,
  subtitle,
  action,
  badge,
  footer,
  children,
  className = '',
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Chấm số cạnh tiêu đề (ví dụ số việc cần xử lý). */
  badge?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {badge}
        {subtitle && <span className="text-[13px] text-slate-500">{subtitle}</span>}
        {action && <span className="ml-auto text-[13px]">{action}</span>}
      </div>
      {children}
      {footer && <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-semibold">{footer}</div>}
    </section>
  );
}
