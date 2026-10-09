import { DomainError } from './domain-error';

/**
 * DB trả exclusion-constraint violation trên `appointment_doctor_slot_excl` (C2, docs/ERD.md
 * mục 4) — hai lịch hẹn cùng bác sĩ trùng khung giờ, kể cả khi hai lễ tân thao tác đồng thời
 * (APP-03). Kiểm ở DB, không phải read-then-write ở service (có race condition) — xem
 * .claude/docs/clinical-workflow.md mục "Đặt lịch".
 */
export class AppointmentSlotConflictError extends DomainError {
  readonly code = 'APPOINTMENT_SLOT_CONFLICT';

  constructor() {
    super('Bác sĩ đã có lịch hẹn khác trùng khung giờ này.');
  }
}

/**
 * DB trả foreign key violation — bác sĩ/phòng không tồn tại hoặc thuộc tenant khác. Từ
 * docs/DECISIONS.md #032, `appointment.patientId` không còn nhận từ client lúc tạo (luôn `null`,
 * xem createAppointmentRequestSchema) nên chỉ còn doctorId/roomId có thể vi phạm FK.
 */
export class AppointmentInvalidReferenceError extends DomainError {
  readonly code = 'APPOINTMENT_INVALID_REFERENCE';

  constructor() {
    super('Bác sĩ hoặc phòng không tồn tại trong phòng khám này.');
  }
}

/**
 * Huỷ/đổi/dời/check-in một lịch hẹn không còn ở trạng thái `SCHEDULED` (đã huỷ/không đến/đã
 * chuyển thành lượt khám) — .claude/docs/clinical-workflow.md mục "Đặt lịch": lịch đã chuyển đổi
 * không thao tác được qua các đường này nữa, luồng huỷ lượt khám ("bỏ về") là việc khác thuộc
 * module `encounter` (S3). Dùng chung cho `cancel` (S2-06), `reschedule` (S2-09), `checkin`
 * (docs/DECISIONS.md #032) — cùng điều kiện `status === 'SCHEDULED'`, không tách nhiều lớp lỗi
 * cho cùng một quy tắc.
 */
export class AppointmentNotCancellableError extends DomainError {
  readonly code = 'APPOINTMENT_NOT_CANCELLABLE';

  constructor() {
    super('Lịch hẹn này không còn ở trạng thái có thể thao tác qua đây.');
  }
}

/**
 * "Đăng ký ca làm việc" Giai đoạn 2 — đặt/sửa/dời lịch hẹn ra ngoài khung giờ bác sĩ đã đăng ký ca
 * cho đúng ngày đó, khi `ClinicSettings.blockBookingOutsideWorkShiftEnabled=true`. CHỈ áp dụng khi
 * bác sĩ CÓ ít nhất 1 ca đăng ký ngày đó — chưa đăng ký ca nào thì không bị chặn (xem comment
 * `clinicSettingsSchema.blockBookingOutsideWorkShiftEnabled`).
 */
export class AppointmentOutsideWorkShiftError extends DomainError {
  readonly code = 'APPOINTMENT_OUTSIDE_WORK_SHIFT';

  constructor() {
    super('Ngoài ca làm việc bác sĩ đã đăng ký cho ngày này.');
  }
}

/**
 * "Đơn xin nghỉ" (#224) — đặt/sửa/dời lịch hẹn vào khung giờ bác sĩ đã được DUYỆT nghỉ. Luôn bật
 * (không phụ thuộc công tắc `blockBookingOutsideWorkShiftEnabled`); đơn mới CHỜ duyệt không chặn.
 */
export class AppointmentDoctorOnLeaveError extends DomainError {
  readonly code = 'APPOINTMENT_DOCTOR_ON_LEAVE';

  constructor() {
    super('Bác sĩ đã được duyệt nghỉ trong khung giờ này.');
  }
}

/**
 * Công tắc con "Chặn cả khi bác sĩ không có ca nào trong ngày" (09/10/2026) — đặt lịch hẹn hoặc tiếp nhận cho
 * bác sĩ KHÔNG có ca nào ngày đó, trong ngày phòng khám đã có bác sĩ khác đăng ký ca. Dùng chung cho Lịch hẹn và
 * Tiếp nhận.
 */
export class DoctorNoShiftOnDateError extends DomainError {
  readonly code = 'DOCTOR_NO_SHIFT_ON_DATE';

  constructor() {
    super('Bác sĩ chưa đăng ký ca làm việc cho ngày này.');
  }
}
