import { ApiError, isPermissionDeniedError } from '../api/client';
import { AccessDeniedState } from './AccessDeniedState';
import { ErrorBanner } from './ErrorBanner';

/**
 * Lỗi tải DANH SÁCH/báo cáo (không phải một bản ghi theo id — cái đó dùng `RecordLoadError`): máy chủ từ chối vì thiếu quyền (`PERMISSION_DENIED`/`PERMISSION_SCOPE_DENIED`, ví dụ tài khoản
 * có quyền ở phạm vi hẹp hơn mức danh sách đòi hỏi) → màn "Không có quyền" có lối quay lại, KHÔNG phải banner "Không tải được" làm người dùng tưởng hệ thống hỏng
 * (`.claude/docs/ui-guidelines.md` mục 17b); lỗi khác (mạng, 5xx) → banner kèm "Thử lại".
 */
export function ListLoadError({
  error,
  fallbackMessage,
  onRetry,
  fallbackTo,
  fallbackLabel,
}: {
  error: unknown;
  /** Câu hiện khi lỗi không phải thiếu quyền và `error` không mang thông điệp riêng. */
  fallbackMessage: string;
  onRetry?: () => void;
  fallbackTo?: string;
  fallbackLabel?: string;
}) {
  if (isPermissionDeniedError(error)) {
    return (
      <AccessDeniedState
        title="Không có quyền xem nội dung này"
        description={error.message}
        fallbackTo={fallbackTo}
        fallbackLabel={fallbackLabel}
      />
    );
  }
  return <ErrorBanner message={error instanceof ApiError ? error.message : fallbackMessage} onRetry={onRetry} />;
}
