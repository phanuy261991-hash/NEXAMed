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

/**
 * Lưu SOAP/chẩn đoán khi lượt khám chưa từng vào `IN_CONSULTATION` (còn `SCHEDULED`/`CHECKED_IN`)
 * hoặc đã `CANCELLED`/`NO_SHOW`. Sửa lại sau khi đã `COMPLETED` **được phép** — xem "Sửa hồ sơ khám
 * sau khi Hoàn tất" (`docs/DECISIONS.md`): mở khoá sửa tại chỗ + audit log trước/sau, KHÔNG phải mô
 * hình đính chính Thông tư 46 (đó là ENC-04/05, Sprint 5, áp dụng cho bản ghi đã `signed_at`).
 */
export class EncounterNotInConsultationError extends DomainError {
  readonly code = 'ENCOUNTER_NOT_IN_CONSULTATION';

  constructor() {
    super('Chỉ ghi được khi lượt khám đang ở trạng thái đang khám hoặc đã hoàn tất.');
  }
}

/**
 * "Hàng đợi ảo" (#064) — "Nhận ca" (claim ticket đang chờ trong hàng chờ chung Khoa,
 * `encounter.doctorId IS NULL`) thất bại vì một bác sĩ khác đã nhận trước (ghi có điều kiện
 * `WHERE doctor_id IS NULL` không match nữa). Khác `ConcurrentModificationError` (version lệch do
 * sửa đổi khác) — lỗi này riêng cho đúng tình huống "chậm chân" trong hàng chờ chung, web hiện toast
 * lịch sự thay vì lỗi đỏ chung chung (xem `docs/DECISIONS.md` #064 điểm 6).
 */
export class EncounterAlreadyClaimedError extends DomainError {
  readonly code = 'ENCOUNTER_ALREADY_CLAIMED';

  constructor() {
    super('Bệnh nhân này vừa được bác sĩ khác tiếp nhận.');
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

/**
 * Sửa `diagnosis`/`clinical_note` khi lượt khám đã "Hoàn tất khám" (`COMPLETED`) — từ Sprint 5
 * (S5-02/03, ENC-04/05) "Hoàn tất khám" tự động KÝ hồ sơ (`signed_at`/`signed_by`), thay thế hẳn cơ
 * chế "sửa tại chỗ" cũ (#066) cho trường hợp này. Sửa sau khi ký phải qua đính chính
 * (`POST .../diagnoses/amend`, `POST .../clinical-note/amend`), bắt buộc lý do — xem
 * .claude/docs/clinical-workflow.md mục "Amendment hồ sơ". 409 — xung đột với trạng thái đã khoá,
 * không phải lỗi input.
 */
export class ClinicalRecordAlreadySignedError extends DomainError {
  readonly code = 'CLINICAL_RECORD_ALREADY_SIGNED';

  constructor() {
    super('Hồ sơ khám đã ký (lượt khám đã hoàn tất) — dùng chức năng "Đính chính" để sửa, không sửa trực tiếp.');
  }
}

/**
 * Thu ngân cơ bản (Sprint 5/6) — "Nhận ca"/"Bắt đầu khám" (`startConsultation()`) bị chặn vì lượt
 * khám còn phiếu thu `UNPAID` và không được phép nợ (tenant tắt "Thanh toán sau", hoặc
 * `allowsDeferredPayment=false`) — ý nghĩa thật của checkbox "Thanh toán sau" đã ghi nhận ở
 * `docs/DECISIONS.md` #080. Chỉ áp dụng cho `status=CHECKED_IN` (chưa từng vào IN_CONSULTATION).
 */
export class EncounterPaymentRequiredError extends DomainError {
  readonly code = 'ENCOUNTER_PAYMENT_REQUIRED';

  constructor() {
    super('Lượt khám này chưa thu tiền — thu tiền ở Thu ngân trước khi vào Hàng đợi khám.');
  }
}
