import { STALE_MESSAGE } from '../api/save-error';
import type { SaveFailure } from '../hooks/useSaveAttempt';
import { SaveErrorBanner } from './SaveErrorBanner';

/**
 * Khối thông báo chung đặt phía trên nút của MỌI form Thêm/Sửa: (1) `stale` — người khác vừa lưu bản mới
 * của bản ghi đang sửa (phát hiện sớm, trước khi bấm Lưu); (2) `saveError` — lỗi vừa lưu (xung đột phiên
 * bản/nghiệp vụ/mất mạng). Cả hai cùng có nút "Tải lại dữ liệu mới" khi caller truyền `onReload`.
 */
export function RecordFormNotice({
  stale = false,
  saveError,
  onReload,
}: {
  stale?: boolean;
  saveError: SaveFailure | null;
  onReload?: () => void | Promise<void>;
}) {
  if (stale) return <SaveErrorBanner message={STALE_MESSAGE} onReload={onReload ? () => void onReload() : undefined} />;
  if (saveError) return <SaveErrorBanner message={saveError.message} onReload={saveError.conflict && onReload ? () => void onReload() : undefined} />;
  return null;
}
