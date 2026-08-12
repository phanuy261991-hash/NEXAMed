import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { Button } from './Button';

/**
 * Báo lỗi inline tại chỗ phát sinh — .claude/docs/ui-guidelines.md mục 3 (Error State: thông báo
 * tại chỗ + nút "Thử lại", không dùng toast chung chung cho lỗi liên quan dữ liệu bệnh nhân).
 * Dùng ở mọi màn hình fetch dữ liệu — đặt ở `shared/ui` với chủ đích tái dùng ngay.
 */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-rose-700">
        <WarningCircle size={20} weight="fill" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <Button type="button" variant="danger" onClick={onRetry} className="px-3 py-1.5">
          <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
          Thử lại
        </Button>
      )}
    </div>
  );
}
