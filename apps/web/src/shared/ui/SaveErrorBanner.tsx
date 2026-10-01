import { ArrowClockwise, Warning } from '@phosphor-icons/react';
import { Button } from './Button';

/**
 * Báo lỗi lưu/xung đột NGAY TRONG form Thêm/Sửa (`.claude/docs/ui-guidelines.md` mục 4.3 — khung đỏ, icon,
 * chữ đậm). Có `onReload` thì hiện nút "Tải lại dữ liệu mới" (xung đột phiên bản: bản ghi đã bị người khác
 * sửa); caller tự quyết định tải lại thế nào (thường: refetch rồi mở lại form với bản mới).
 */
export function SaveErrorBanner({ message, onReload, reloading = false }: { message: string; onReload?: () => void; reloading?: boolean }) {
  return (
    <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-rose-300 bg-rose-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-rose-700">
        <Warning size={18} weight="fill" className="flex-none" aria-hidden="true" />
        {message}
      </div>
      {onReload && (
        <Button type="button" variant="danger" loading={reloading} onClick={onReload} className="flex-none px-3 py-1.5">
          <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
          Tải lại dữ liệu mới
        </Button>
      )}
    </div>
  );
}
