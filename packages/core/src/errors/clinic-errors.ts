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

/**
 * "Tạm nghỉ / Đóng ca" của bác sĩ — lễ tân/clinic_admin thao tác hộ một bác sĩ khác nhưng cấu hình
 * "Cho phép lễ tân đóng ca hộ" (`ClinicSettings.allowReceptionistEndShift`) đang tắt. Chỉ áp dụng
 * cho nhánh "hộ" — bác sĩ tự thao tác cho chính mình không bao giờ gặp lỗi này.
 */
export class DoctorAvailabilityReceptionDisabledError extends DomainError {
  readonly code = 'DOCTOR_AVAILABILITY_RECEPTION_DISABLED';

  constructor() {
    super('Phòng khám chưa cho phép lễ tân đóng ca hộ bác sĩ — bật ở "Cấu hình khám".');
  }
}

/**
 * "Đóng ca hôm nay" (Trường hợp 1 — đóng đột xuất) khi cấu hình "Cho phép bác sĩ đóng ca khẩn cấp"
 * (`ClinicSettings.allowEmergencyEndShift`) đang tắt. KHÔNG áp dụng cho Trường hợp 2 (hết giờ làm
 * việc, `trigger='SCHEDULED_END'`) — trường hợp đó luôn được phép, đã hỏi và chốt với chủ dự án.
 */
export class DoctorAvailabilityEmergencyDisabledError extends DomainError {
  readonly code = 'DOCTOR_AVAILABILITY_EMERGENCY_DISABLED';

  constructor() {
    super('Phòng khám chưa cho phép đóng ca khẩn cấp — bật ở "Cấu hình khám", hoặc chờ nhắc tự động đúng giờ đóng cửa.');
  }
}

/**
 * "Ca làm việc" (`work_shift`, danh mục quản lý theo từng phòng khám) — `endTime` không sau
 * `startTime`, hoặc `restStartTime`/`restEndTime` (khi cả hai có mặt) không hợp lệ (không theo
 * đúng thứ tự, hoặc nằm ngoài khoảng `[startTime, endTime]` của chính ca đó).
 */
export class WorkShiftInvalidTimeRangeError extends DomainError {
  readonly code = 'WORK_SHIFT_INVALID_TIME_RANGE';

  constructor(message: string) {
    super(message);
  }
}

/** Mã tự sinh trùng hết số lần thử (xác suất cực nhỏ với UUID ngẫu nhiên — gần như không xảy ra
 * thật, cùng khuôn `ReferenceCatalogDuplicateCodeError`). */
export class WorkShiftDuplicateCodeError extends DomainError {
  readonly code = 'WORK_SHIFT_DUPLICATE_CODE';

  constructor() {
    super('Không sinh được mã ca làm việc duy nhất, thử lại.');
  }
}
