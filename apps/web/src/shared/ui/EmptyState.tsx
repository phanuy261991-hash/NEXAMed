import type { Icon } from '@phosphor-icons/react';

/**
 * Trạng thái rỗng dùng chung — theo .claude/docs/ui-guidelines.md mục 3 (icon nhạt màu + mô tả
 * rõ ràng). `action` tuỳ chọn: chỉ truyền khi thật sự có việc để làm ngay (ví dụ "Thêm bệnh
 * nhân"); bỏ trống khi toàn bộ tính năng chưa tồn tại (ví dụ các trang chờ module S2+).
 */
export function EmptyState({
  icon: IconComponent,
  title,
  description,
  action,
}: {
  icon: Icon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
      <IconComponent size={40} weight="regular" className="mb-4 text-slate-300" aria-hidden="true" />
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
