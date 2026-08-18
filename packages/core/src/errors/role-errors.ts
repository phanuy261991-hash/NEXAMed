import { DomainError } from './domain-error';

/** DB trả unique violation trên `(tenant_id, name) WHERE deleted_at IS NULL` — trùng tên vai trò (ADM-07). */
export class RoleDuplicateNameError extends DomainError {
  readonly code = 'ROLE_DUPLICATE_NAME';

  constructor() {
    super('Tên vai trò này đã tồn tại trong phòng khám.');
  }
}

/** Vai trò hệ thống (`is_system_default=true`) không đổi tên/ẩn được — chỉ sửa ma trận quyền (ADM-07). */
export class RoleImmutableError extends DomainError {
  readonly code = 'ROLE_IMMUTABLE';

  constructor() {
    super('Vai trò mặc định của hệ thống không thể đổi tên hoặc ẩn — chỉ có thể sửa ma trận quyền.');
  }
}

/** Không ẩn được vai trò tuỳ biến còn tài khoản đang gán (ADM-07) — tránh tài khoản mất hết vai trò âm thầm. */
export class RoleInUseError extends DomainError {
  readonly code = 'ROLE_IN_USE';

  constructor() {
    super('Vai trò này đang được gán cho ít nhất một tài khoản — gỡ vai trò khỏi tài khoản trước khi ẩn.');
  }
}

/** `roleIds` gửi lên tạo/sửa tài khoản có giá trị không thuộc tenant hiện tại hoặc đã bị ẩn (ADM-01, sau ADM-07). */
export class RoleInvalidReferenceError extends DomainError {
  readonly code = 'ROLE_INVALID_REFERENCE';

  constructor() {
    super('Một hoặc nhiều vai trò được chọn không hợp lệ.');
  }
}