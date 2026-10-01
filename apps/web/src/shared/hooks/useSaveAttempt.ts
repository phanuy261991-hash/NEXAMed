import { useCallback, useState } from 'react';
import { ApiError } from '../api/client';
import { describeSaveError, isConflictError } from '../api/save-error';

export interface SaveFailure {
  message: string;
  /** `true` = xung đột phiên bản (người khác vừa sửa) — UI hiện nút "Tải lại dữ liệu mới". */
  conflict: boolean;
  /** Mã lỗi nghiệp vụ của server (`ApiError.code`) — để form tự thay câu riêng cho một vài mã (ví dụ trùng mã). */
  code?: string;
}

/**
 * Bọc thao tác lưu của form Thêm/Sửa: lỗi KHÔNG còn bị nuốt/ném ra ngoài mà thành `saveError` để hiện
 * inline (`SaveErrorBanner`). `run()` trả `true` nếu lưu thành công — caller mới đóng modal/làm trống form.
 */
export function useSaveAttempt() {
  const [saveError, setSaveError] = useState<SaveFailure | null>(null);

  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setSaveError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setSaveError({ message: describeSaveError(err), conflict: isConflictError(err), code: err instanceof ApiError ? err.code : undefined });
      return false;
    }
  }, []);

  const clear = useCallback(() => setSaveError(null), []);
  return { saveError, run, clear };
}
