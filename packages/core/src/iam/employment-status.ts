import { AccountCannotReactivateWhileResignedError } from '../errors/user-account-errors';

/**
 * Tự động vô hiệu hoá tài khoản khi Trạng thái làm việc thuộc nhóm tự-vô-hiệu-hoá (ví dụ "Nghỉ
 * việc", `deactivatesAccount=true` — xem cột `reference_catalog.deactivates_account`, mở rộng
 * ADM-01). Hàm thuần, dùng trong `user-account.service.ts` lúc tạo/sửa tài khoản, sau khi đã tra
 * `ReferenceCatalogReaderPort` cho `employmentStatusCode` (nếu có).
 *
 * - `explicitIsActiveRequest`: giá trị `isActive` client GỬI TƯỜNG MINH trong request (`undefined`
 *   nghĩa là client không đề cập tới trường này — tạo mới không có trường `isActive`, sửa hồ sơ
 *   không đổi trạng thái hoạt động).
 * - `fallbackIsActive`: giá trị dùng khi trạng thái làm việc không phải nhóm tự-vô-hiệu-hoá VÀ
 *   client không gửi `isActive` tường minh — tạo mới truyền `true` (mặc định), sửa hồ sơ truyền
 *   `existing.isActive` (giữ nguyên).
 *
 * Ném lỗi (không âm thầm bỏ qua) CHỈ khi client cố ép `isActive:true` trong khi trạng thái vẫn
 * tự-vô-hiệu-hoá — tránh admin tưởng đã kích hoạt lại nhưng thực ra không có tác dụng. Trường hợp
 * tạo mới một nhân viên đã "Nghỉ việc" từ đầu (nhập liệu lịch sử, không có `isActive` tường minh)
 * không ném lỗi — chỉ lặng lẽ tạo tài khoản ở trạng thái vô hiệu.
 */
export function resolveAccountActiveState(
  employmentStatus: { deactivatesAccount: boolean } | null,
  explicitIsActiveRequest: boolean | undefined,
  fallbackIsActive: boolean,
): boolean {
  if (employmentStatus?.deactivatesAccount !== true) {
    return explicitIsActiveRequest ?? fallbackIsActive;
  }

  if (explicitIsActiveRequest === true) {
    throw new AccountCannotReactivateWhileResignedError();
  }

  return false;
}
