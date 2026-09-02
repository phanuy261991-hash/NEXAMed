import { DomainError } from './domain-error';

/** Đăng ký trùng đúng 1 ca cho cùng 1 ngày (unique `(tenant_id, user_id, work_date, work_shift_id)
 * WHERE deleted_at IS NULL`) — không chặn đăng ký nhiều ca KHÁC NHAU cùng ngày. */
export class WorkShiftAssignmentDuplicateError extends DomainError {
  readonly code = 'WORK_SHIFT_ASSIGNMENT_DUPLICATE';

  constructor() {
    super('Đã đăng ký đúng ca này cho ngày đã chọn.');
  }
}

/**
 * Tự sửa/xoá ca đã đăng ký NGOÀI ngày lịch Việt Nam đã tạo (`createdAt`) — chỉ áp dụng cho scope
 * `personal` (chính chủ). Khác lỗi 404 "không tồn tại/không thuộc về mình" (đây LÀ bản ghi của
 * actor, chỉ bị khoá theo thời gian) nên trả message rõ ràng thay vì giấu bằng 404.
 */
export class WorkShiftAssignmentLockedError extends DomainError {
  readonly code = 'WORK_SHIFT_ASSIGNMENT_LOCKED';

  constructor() {
    super('Ca đã khoá (chỉ sửa/xoá được trong đúng ngày đăng ký) — liên hệ quản lý để đổi.');
  }
}

/**
 * "Cấu hình chung" — công tắc `allowStaffSelfScheduleEnabled` tắt, chặn nhân viên (scope
 * `personal`) tự đăng ký/xoá ca. Cùng ngữ nghĩa 403 với `DOCTOR_AVAILABILITY_*_DISABLED` (thao tác
 * bị cấu hình phòng khám chặn, không phải thiếu quyền RBAC — đã kiểm ở `PermissionGuard` trước đó).
 */
export class WorkShiftAssignmentSelfScheduleDisabledError extends DomainError {
  readonly code = 'WORK_SHIFT_ASSIGNMENT_SELF_SCHEDULE_DISABLED';

  constructor() {
    super('Tự đăng ký ca đang bị tắt — liên hệ quản lý để được phân công ca làm việc.');
  }
}
