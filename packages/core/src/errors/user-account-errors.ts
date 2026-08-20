import { DomainError } from './domain-error';

/** DB trả unique violation trên `(tenant_id, username)` — trùng tên đăng nhập (S2-07, ADM-01). */
export class UserAccountDuplicateUsernameError extends DomainError {
  readonly code = 'USER_ACCOUNT_DUPLICATE_USERNAME';

  constructor() {
    super('Tên đăng nhập này đã được dùng trong phòng khám.');
  }
}

/**
 * Tạo/sửa tài khoản với Trạng thái làm việc thuộc loại tự-vô-hiệu-hoá (`deactivatesAccount=true`,
 * ví dụ "Nghỉ việc") nhưng client vẫn gửi kèm `isActive:true` — xung đột với trạng thái hiện có
 * (mở rộng ADM-01), xem `resolveAccountActiveState` ở `iam/employment-status.ts`.
 */
export class AccountCannotReactivateWhileResignedError extends DomainError {
  readonly code = 'ACCOUNT_CANNOT_REACTIVATE_WHILE_RESIGNED';

  constructor() {
    super('Không thể kích hoạt tài khoản khi Trạng thái làm việc vẫn đang ở nhóm tự động vô hiệu hoá (ví dụ "Nghỉ việc"). Đổi Trạng thái làm việc trước.');
  }
}
