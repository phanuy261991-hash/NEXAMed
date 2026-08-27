import type { ReactNode } from 'react';
import { Button } from './Button';

/**
 * Thanh công cụ nổi khi đang chọn ≥1 dòng (`.claude/docs/ui-guidelines.md` mục 4.2) — hiện tại
 * CHỈ hiện số lượng đã chọn + nút bỏ chọn, chưa có hành động hàng loạt nào được chốt. Thêm nút
 * hành động thật vào đây (children) khi có yêu cầu cụ thể.
 */
export function SelectionToolbar({ count, onClear, children }: { count: number; onClear: () => void; children?: ReactNode }) {
  if (count === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-lg">
        <span className="text-sm font-semibold text-slate-800">Đã chọn {count}</span>
        {children}
        <Button type="button" variant="secondary" className="px-3 py-1 text-xs" onClick={onClear}>
          Bỏ chọn
        </Button>
      </div>
    </div>
  );
}