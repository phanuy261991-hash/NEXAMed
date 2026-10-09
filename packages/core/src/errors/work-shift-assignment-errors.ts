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
    super('Ca này do quản lý xếp hoặc đã khoá — liên hệ quản lý để đổi.');
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

/**
 * "Khoá bảng ca" theo tháng (2026-09-03) — tháng của `work_date` đã qua mốc chốt
 * (`tenant_setting.work_shift_assignment_lock_grace_days`) và actor KHÔNG có quyền
 * `work_shift_assignment.unlock` (scope `global`). Áp dụng cho MỌI `dataScope` kể cả `global` —
 * khác `WorkShiftAssignmentLockedError` (chỉ áp `personal`, khoá theo NGÀY đăng ký).
 */
export class WorkShiftAssignmentMonthLockedError extends DomainError {
  readonly code = 'WORK_SHIFT_ASSIGNMENT_MONTH_LOCKED';

  constructor() {
    super('Lịch làm việc tháng này đã khoá (đã qua ngày chốt bảng ca) — liên hệ người có quyền mở khoá.');
  }
}

/**
 * Đăng ký/sửa/xoá ca cho NGÀY ĐÃ QUA (chốt 2026-10-09, `docs/DECISIONS.md` #224) — ngày đã qua không
 * được thay đổi, kể cả khi tháng chưa chốt; chỉ người có quyền `work_shift_assignment.unlock` làm được.
 */
export class WorkShiftAssignmentPastDateError extends DomainError {
  readonly code = 'WORK_SHIFT_ASSIGNMENT_PAST_DATE';

  constructor() {
    super('Ngày đã qua không đăng ký/sửa/xoá ca được — liên hệ người có quyền "Sửa lịch đã khoá".');
  }
}

/** "Duyệt đăng ký ca" (#225) — nhân viên chỉ tự đăng ký/xoá ca của tháng SAU tháng hiện tại. */
export class WorkShiftAssignmentMonthNotOpenError extends DomainError {
  readonly code = 'WORK_SHIFT_ASSIGNMENT_MONTH_NOT_OPEN';

  constructor() {
    super('Chỉ tự đăng ký được ca của tháng sau; tháng này do quản lý xếp.');
  }
}

/** Bảng đăng ký tháng đã gửi duyệt hoặc đã duyệt — nhân viên không tự sửa/xoá/thêm ca được nữa. */
export class WorkShiftAssignmentSubmissionLockedError extends DomainError {
  readonly code = 'WORK_SHIFT_ASSIGNMENT_SUBMISSION_LOCKED';

  constructor() {
    super('Lịch tháng này đã gửi duyệt hoặc đã duyệt — chỉ xin nghỉ hoặc đổi ca, không sửa trực tiếp.');
  }
}

/** Thao tác không hợp lệ với trạng thái hiện tại của bảng đăng ký tháng (gửi lại/duyệt khi không ở "Chờ duyệt"...). */
export class ScheduleSubmissionInvalidStatusError extends DomainError {
  readonly code = 'SCHEDULE_SUBMISSION_INVALID_STATUS';

  constructor() {
    super('Bảng đăng ký tháng không còn ở trạng thái cho phép thao tác này.');
  }
}

/** Gửi duyệt khi tháng chưa có ca nào. */
export class ScheduleSubmissionEmptyError extends DomainError {
  readonly code = 'SCHEDULE_SUBMISSION_EMPTY';

  constructor() {
    super('Tháng này chưa đăng ký ca nào nên chưa gửi duyệt được.');
  }
}
