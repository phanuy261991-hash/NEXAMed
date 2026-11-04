import type { ReactNode } from 'react';

/**
 * Khối nội dung của các trang TỔNG QUAN (docs/DECISIONS.md #283, mockup hướng B đã chốt 04/11/2026): nền trắng bo góc lớn, KHÔNG viền, KHÔNG bóng, KHÔNG thanh tiêu đề tô nền —
 * tiêu đề nằm ngay trong khối, phân tách bằng khoảng trống. Chỉ dùng cho trang Tổng quan (chủ phòng khám có nền xám xanh nhạt `DashboardSurface` phía sau); các trang khác của ứng dụng
 * giữ kiểu thẻ cũ theo `.claude/docs/ui-guidelines.md`. Không chứa logic nghiệp vụ — nhận nội dung qua props.
 */
export function DashboardPanel({
  title,
  subtitle,
  action,
  badge,
  children,
  className = '',
}: {
  title: string;
  subtitle?: ReactNode;
  /** Liên kết/nút phụ ở góc phải đầu khối (ví dụ "Mở danh sách cần thu"). */
  action?: ReactNode;
  /** Chấm số cạnh tiêu đề (ví dụ số phiếu chờ thu). */
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl bg-white px-6 py-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {badge}
        {subtitle && <span className="text-sm text-slate-500">{subtitle}</span>}
        {action && <span className="ml-auto text-sm">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** Nền xám xanh nhạt bao toàn trang Tổng quan để các khối trắng nổi lên mà không cần viền/bóng. */
export function DashboardSurface({ children }: { children: ReactNode }) {
  return <div className="min-h-full bg-slate-100">{children}</div>;
}

/** Dòng tổng cuối khối: nền nhạt bo góc (thay cho thanh nền xám phẳng của kiểu cũ). */
export function DashboardTotalRow({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'blue' }) {
  return <div className={`mt-2 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${tone === 'blue' ? 'bg-blue-50' : 'bg-slate-50'}`}>{children}</div>;
}
