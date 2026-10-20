import { DomainError } from './domain-error';

/** Lưu mã liên thông lần đầu mà chưa nhập mật khẩu (docs/DECISIONS.md #242, giai đoạn 3). Mặc định 422. */
export class InteropPasswordRequiredError extends DomainError {
  readonly code = 'INTEROP_PASSWORD_REQUIRED';

  constructor() {
    super('Nhập mật khẩu liên thông (lần đầu lưu bắt buộc).');
  }
}
