import { DomainError } from './domain-error';

/**
 * Upload logo phòng khám (trang "Thông tin phòng khám", 2026-08-13) không hợp lệ — sai định dạng
 * (kiểm magic byte qua `sniffImageExtension`, không tin `Content-Type`) hoặc vượt kích thước cho
 * phép. Tách riêng khỏi `InvalidPhotoError` (patient-errors.ts) vì thuộc domain `clinic`, không
 * phải `patient`, dù cùng khuôn kiểm tra.
 */
export class InvalidLogoError extends DomainError {
  readonly code = 'CLINIC_INVALID_LOGO';

  constructor(message: string) {
    super(message);
  }
}
