import { DomainError } from './domain-error';

/** Công ty đang tạm ngưng bởi người vận hành nền tảng (docs/DECISIONS.md #237) — không đăng nhập/làm mới phiên được, dữ liệu vẫn giữ nguyên. */
export class TenantSuspendedError extends DomainError {
  readonly code = 'TENANT_SUSPENDED';

  constructor() {
    super('Công ty đang tạm ngưng sử dụng. Vui lòng liên hệ nhà cung cấp để được hỗ trợ.');
  }
}

/** Địa chỉ truy cập không ứng với công ty nào (tên miền phụ sai hoặc công ty chưa tồn tại). */
export class TenantNotFoundError extends DomainError {
  readonly code = 'TENANT_NOT_FOUND';

  constructor() {
    super('Không tìm thấy công ty này.');
  }
}

export class TenantCodeInvalidError extends DomainError {
  readonly code = 'PLATFORM_TENANT_CODE_INVALID';

  constructor(reason: 'format' | 'reserved') {
    super(
      reason === 'reserved'
        ? 'Mã công ty này được dành riêng cho hệ thống, hãy chọn mã khác.'
        : 'Mã công ty gồm 3-30 ký tự: chữ thường không dấu, số và gạch ngang, không bắt đầu hoặc kết thúc bằng gạch ngang.',
    );
  }
}

export class TenantCodeTakenError extends DomainError {
  readonly code = 'PLATFORM_TENANT_CODE_TAKEN';

  constructor() {
    super('Mã công ty này đã được dùng.');
  }
}

export class TenantAlreadySuspendedError extends DomainError {
  readonly code = 'PLATFORM_TENANT_ALREADY_SUSPENDED';

  constructor() {
    super('Công ty này đã tạm ngưng.');
  }
}

export class TenantNotSuspendedError extends DomainError {
  readonly code = 'PLATFORM_TENANT_NOT_SUSPENDED';

  constructor() {
    super('Công ty này đang hoạt động.');
  }
}

/** Mã OTP sai/hết hạn hoặc mã tạm cho bước OTP không còn hiệu lực. */
export class PlatformOtpInvalidError extends DomainError {
  readonly code = 'PLATFORM_OTP_INVALID';

  constructor() {
    super('Mã xác thực không đúng hoặc đã hết hạn.');
  }
}

/** Công ty chưa có tài khoản quản trị nào để đặt lại mật khẩu. */
export class TenantAdminNotFoundError extends DomainError {
  readonly code = 'PLATFORM_TENANT_ADMIN_NOT_FOUND';

  constructor() {
    super('Công ty này chưa có tài khoản quản trị đang hoạt động.');
  }
}
