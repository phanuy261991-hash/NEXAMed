import { ApiError, isPermissionDeniedError } from '../api/client';
import { AccessDeniedState } from './AccessDeniedState';
import { ErrorBanner } from './ErrorBanner';

/**
 * Lỗi tải MỘT bản ghi theo id (trang chi tiết/biểu mẫu): `NOT_FOUND`/`PERMISSION_DENIED` → trang "Không có quyền xem nội dung này" có lối quay lại (máy chủ trả 404 cho bản ghi
 * thuộc chi nhánh khác, nên người dùng cần lời giải thích và lối thoát chứ không phải banner lỗi); lỗi khác (mạng, 500) → banner lỗi kèm "Thử lại" như cũ.
 */
export function RecordLoadError({
  error,
  fallbackMessage,
  onRetry,
  fallbackTo,
  fallbackLabel,
}: {
  error: unknown;
  /** Thông báo khi lỗi không phải 404/403 và `error` không mang message riêng. */
  fallbackMessage: string;
  onRetry?: () => void;
  fallbackTo?: string;
  fallbackLabel?: string;
}) {
  if (isPermissionDeniedError(error) || (error instanceof ApiError && error.code === 'NOT_FOUND')) {
    return <AccessDeniedState fallbackTo={fallbackTo} fallbackLabel={fallbackLabel} />;
  }
  return <ErrorBanner message={error instanceof ApiError ? error.message : fallbackMessage} onRetry={onRetry} />;
}
