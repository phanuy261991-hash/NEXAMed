import type { EncounterStatus } from '@nexamed/shared';
import { DomainError } from './domain-error';

/**
 * Chuyển trạng thái `encounter` không hợp lệ theo state machine đã chốt (xem
 * .claude/docs/clinical-workflow.md, `encounter-state-machine.ts`) — ví dụ chuyển thẳng
 * `CHECKED_IN → COMPLETED` bỏ qua `IN_CONSULTATION`, hoặc thao tác trên `encounter` đã
 * `COMPLETED`/`CANCELLED`/`NO_SHOW`. `from`/`to` chỉ để log/debug nội bộ, không lộ ra message
 * client (đúng .claude/docs/coding-standards.md — message không lộ chi tiết nội bộ).
 */
export class EncounterInvalidTransitionError extends DomainError {
  readonly code = 'ENCOUNTER_INVALID_TRANSITION';

  constructor(
    public readonly from: EncounterStatus,
    public readonly to: EncounterStatus,
  ) {
    super('Lượt khám không ở trạng thái có thể chuyển đổi này.');
  }
}

/**
 * Double check-in race: hai request check-in cùng một `appointment` gần như đồng thời — bắt từ
 * P2002 trên partial unique index `encounter_tenant_id_appointment_id_key` (xem migration). Cùng
 * tinh thần với `AppointmentSlotConflictError` (chặn ở DB, không phải read-then-write).
 */
export class EncounterAlreadyExistsError extends DomainError {
  readonly code = 'ENCOUNTER_ALREADY_EXISTS';

  constructor() {
    super('Lịch hẹn này đã được tiếp nhận (tạo lượt khám) trước đó.');
  }
}

/**
 * Nhập sinh hiệu (REC-02/03) khi lượt khám không còn ở `CHECKED_IN`/`IN_CONSULTATION` — cho phép cả
 * hai trạng thái (không chỉ lúc tiếp nhận) để bác sĩ bổ sung/đo lại ngay trong màn khám (S3-06/07,
 * yêu cầu chủ dự án 2026-08-20).
 */
export class EncounterNotCheckedInError extends DomainError {
  readonly code = 'ENCOUNTER_NOT_CHECKED_IN';

  constructor() {
    super('Chỉ nhập được sinh hiệu khi lượt khám đang ở trạng thái đã tiếp nhận hoặc đang khám.');
  }
}

/** Lưu SOAP/chẩn đoán hoặc hoàn tất khám khi lượt khám không còn ở `IN_CONSULTATION` (đã hoàn tất/huỷ). */
export class EncounterNotInConsultationError extends DomainError {
  readonly code = 'ENCOUNTER_NOT_IN_CONSULTATION';

  constructor() {
    super('Chỉ ghi được khi lượt khám đang ở trạng thái đang khám.');
  }
}

/**
 * Khám bệnh (S3-05→07) — vi phạm bất biến nghiệp vụ "đúng một chẩn đoán chính" khi lưu danh sách
 * chẩn đoán hoặc lúc hoàn tất khám (.claude/docs/clinical-workflow.md mục "Khám bệnh"). Zod
 * (`saveDiagnosesRequestSchema`) đã chặn phần lớn ở tầng input cho `PUT .../diagnoses`; lỗi này còn
 * cần cho `completeConsultation()` (không có input nào để Zod kiểm — đọc thẳng từ DB) và làm lớp
 * phòng thủ thứ hai nếu service tự tính sai. Không phải xung đột trạng thái đồng thời (không map
 * trong `DOMAIN_ERROR_STATUS` → rơi về mặc định 422, đúng ý nghĩa).
 */
export class DiagnosisPrimaryRequiredError extends DomainError {
  readonly code = 'DIAGNOSIS_PRIMARY_REQUIRED';

  constructor() {
    super('Phải có đúng một chẩn đoán chính trước khi hoàn tất lượt khám.');
  }
}
