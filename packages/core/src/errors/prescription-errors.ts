import { DomainError } from './domain-error';

/**
 * Kê đơn (Sprint 4, S4-01→04) — tạo/sửa dòng thuốc khi lượt khám chưa từng vào `IN_CONSULTATION`
 * và cũng chưa `COMPLETED` (còn `SCHEDULED`/`CHECKED_IN`) hoặc đã `CANCELLED`/`NO_SHOW`. Cùng điều
 * kiện với `EncounterNotInConsultationError` của `diagnosis`/`clinical_note` (cho sửa sau khi
 * `COMPLETED`, .claude/docs/clinical-workflow.md) — tái dùng nguyên lớp đó ở service, không tạo
 * lỗi riêng trùng lặp.
 */

/**
 * Kê đơn khi chưa có chẩn đoán chính (.claude/docs/clinical-workflow.md: "Tạo được khi encounter ở
 * IN_CONSULTATION và đã có chẩn đoán chính"). Không map trong `DOMAIN_ERROR_STATUS` → 422 mặc định
 * (vi phạm quy tắc nghiệp vụ, không phải xung đột trạng thái đồng thời).
 */
export class PrescriptionRequiresDiagnosisError extends DomainError {
  readonly code = 'PRESCRIPTION_REQUIRES_DIAGNOSIS';

  constructor() {
    super('Phải có chẩn đoán chính trước khi kê đơn thuốc.');
  }
}

/**
 * Ký đơn khi chưa có dòng thuốc nào — chặn tạo "đơn rỗng". 422 mặc định.
 */
export class PrescriptionEmptyError extends DomainError {
  readonly code = 'PRESCRIPTION_EMPTY';

  constructor() {
    super('Đơn thuốc phải có ít nhất một dòng thuốc trước khi ký.');
  }
}

/**
 * Sửa dòng thuốc trên đơn ĐÃ ký (`signedAt != null`) — lớp phòng thủ ở tầng service, DB có trigger
 * C8 chặn cứng ở tầng thấp hơn (xem migration). Sửa đơn đã ký phải qua `amend()` (đính chính, bắt
 * buộc lý do), không sửa tại chỗ như `diagnosis`/`clinical_note` (2 bảng đó chưa có khái niệm ký ở
 * v1). 409 — xung đột với trạng thái hiện có (đơn đã khoá), không phải lỗi input.
 */
export class PrescriptionAlreadySignedError extends DomainError {
  readonly code = 'PRESCRIPTION_ALREADY_SIGNED';

  constructor() {
    super('Đơn thuốc đã ký, không thể sửa trực tiếp — dùng chức năng "Sửa đơn" để đính chính.');
  }
}

/** DB trả unique violation trên `(tenant_id, code)` của `drug` — trùng mã thuốc trong cùng phòng khám. */
export class DrugDuplicateCodeError extends DomainError {
  readonly code = 'DRUG_DUPLICATE_CODE';

  constructor() {
    super('Mã thuốc này đã tồn tại trong danh mục.');
  }
}
