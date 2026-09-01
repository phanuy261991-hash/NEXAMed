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
