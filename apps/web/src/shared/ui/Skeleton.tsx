/**
 * Khung xương chờ tải — theo .claude/docs/ui-guidelines.md mục 3 (đồng bộ hình dáng dữ liệu
 * thật, không dùng spinner chung chung). Dùng ở mọi màn hình có fetch dữ liệu (danh sách bệnh
 * nhân hôm nay, các danh sách/chi tiết sau này) — đặt ở `shared/ui` với chủ đích tái dùng ngay.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} aria-hidden="true" />;
}
