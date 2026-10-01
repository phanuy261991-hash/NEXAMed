import { ApiError } from './client';

/**
 * Lấy MỘT bản ghi theo id từ endpoint danh sách — dùng cho `useEditedRecordGuard` ở các trang quản trị mà
 * danh sách vốn nhỏ, không phân trang và chưa có `GET :id` riêng (Phòng/Tầng, Khoa/Phòng, Quỹ, Ca làm
 * việc, Vai trò, Đơn thuốc mẫu). Danh sách lớn/có phân trang thì thêm `GET :id` thay vì dùng hàm này
 * (xem `drug.api.ts#getDrug`). Không còn trong danh sách (đã ẩn/xoá) → ném `NOT_FOUND`: guard coi là
 * "không còn bản ghi" và `reload()` sẽ đóng form.
 */
export async function fetchOneFromList<T extends { id: string }>(load: () => Promise<{ items: T[] }>, id: string): Promise<T> {
  const found = (await load()).items.find((item) => item.id === id);
  if (!found) throw new ApiError('NOT_FOUND', 'Bản ghi không còn tồn tại.');
  return found;
}
