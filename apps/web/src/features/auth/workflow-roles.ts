/**
 * Vai trò cho các khu vực gate theo QUYẾT ĐỊNH NGHIỆP VỤ (workflow), không phải proxy cho một
 * quyền cụ thể — khác toàn bộ phần còn lại của app đã chuyển sang `usePermission.ts` (2026-09-04).
 * Đặt riêng ở đây làm NGUỒN DUY NHẤT cho cả `Sidebar.tsx` (ẩn/hiện menu) lẫn route guard
 * (`RequirePermissionRoute.tsx`) — tránh trùng lặp mảng vai trò ở 2 nơi rồi lệch nhau dần.
 */

/** "Hàng đợi khám" — khu vực RIÊNG cho bác sĩ, đã chốt với chủ dự án (điều dưỡng/lễ tân cũng có
 * `encounter.read` nhưng cố tình không cho vào màn này — không phải bug thiếu quyền). */
export const DOCTOR_QUEUE_ROLES = ['doctor', 'clinic_admin'];

/**
 * Các khu vực RIÊNG cho vai trò Bác sĩ, KHÔNG gồm `clinic_admin` (khác `DOCTOR_QUEUE_ROLES` ở
 * trên) — "Tạm nghỉ/Đóng ca" (`TopBar.tsx`), "Chọn phòng làm việc hôm nay" (`RoomSessionGate.tsx`,
 * `clinic.queries.ts` `useRoomOptionsQuery`). Gom về đây (S6-03, rà soát bảo mật) — trước đây 3
 * nơi tự định nghĩa `isDoctor`/`DOCTOR_ROLE` riêng lẻ, đúng loại rủi ro "nguồn không duy nhất" mà
 * `.claude/docs/security-audit.md` mục "Ràng buộc khi viết code" cảnh báo sau sự cố #119.
 */
export const DOCTOR_ONLY_ROLES = ['doctor'];
