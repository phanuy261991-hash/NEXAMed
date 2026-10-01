import { ApiError, isNetworkError } from './client';

/** Server từ chối vì bản ghi đã bị người khác sửa sau lúc form này được mở (`version` lệch — khoá lạc quan). */
export function isConflictError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'CONCURRENT_MODIFICATION';
}

export const CONFLICT_MESSAGE = 'Dữ liệu này vừa được người khác cập nhật nên chưa lưu được. Bấm "Tải lại dữ liệu mới" để xem bản mới nhất rồi sửa lại.';
export const STALE_MESSAGE = 'Người khác vừa cập nhật bản ghi này. Bấm "Tải lại dữ liệu mới" để xem bản mới nhất trước khi sửa tiếp.';

/** Câu báo lỗi lưu thống nhất cho mọi form Thêm/Sửa — xung đột phiên bản và mất mạng có câu riêng dễ hiểu, lỗi nghiệp vụ khác giữ nguyên thông điệp server. */
export function describeSaveError(err: unknown): string {
  if (isConflictError(err)) return CONFLICT_MESSAGE;
  if (err instanceof ApiError) return err.message;
  if (isNetworkError(err)) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
  return 'Có lỗi xảy ra, vui lòng thử lại.';
}

/** Xung đột khi thao tác nhanh ở danh sách (Ẩn/Kích hoạt lại) — danh sách được tải lại ngay, người dùng chỉ cần bấm lại. */
export const ACTION_CONFLICT_MESSAGE = 'Dữ liệu vừa được người khác cập nhật nên thao tác chưa thực hiện. Danh sách đã được tải lại — kiểm tra rồi thử lại.';
