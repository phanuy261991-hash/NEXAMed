import { DomainError } from './domain-error';

/**
 * Khoá mã hoá hệ thống (`ENCRYPTION_KEY` trong `.env`) và kiểm tra khớp dữ liệu (docs/DECISIONS.md #262). Dữ liệu nhạy cảm (số CCCD, số thẻ BHYT, mật khẩu cổng liên thông) được mã hoá bằng khoá này;
 * mất khoá hoặc dùng khoá khác thì không giải mã được.
 */

/**
 * Khoá đang chạy KHÔNG khớp khoá đã mã hoá dữ liệu hiện có (thường do khôi phục sao lưu sang máy mới mà thiếu `.env` gốc). Từ chối GHI MỚI các trường mã hoá — nếu cho ghi, một cột sẽ trộn hai khoá
 * và không còn đọc được bằng khoá nào. Phần đọc không bị chặn (trường mã hoá hiện "không đọc được"). 409: trạng thái hệ thống không cho phép thao tác này.
 */
export class EncryptionKeyMismatchError extends DomainError {
  readonly code = 'ENCRYPTION_KEY_MISMATCH';

  constructor() {
    super('Khoá hệ thống không khớp với dữ liệu đã lưu nên chưa thể lưu thông tin được mã hoá (số CCCD, thẻ BHYT...). Liên hệ quản trị viên để khôi phục đúng file khoá.');
  }
}
