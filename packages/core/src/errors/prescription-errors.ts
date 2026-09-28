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

/** Kho Thuốc GĐ5 — DB trả unique violation trên `(tenant_id, shortcut_code)` của `drug` — trùng gõ
 * tắt tìm thuốc trong cùng phòng khám. */
export class DrugDuplicateShortcutCodeError extends DomainError {
  readonly code = 'DRUG_DUPLICATE_SHORTCUT_CODE';

  constructor() {
    super('Mã gõ tắt này đã được gán cho thuốc khác.');
  }
}

/**
 * Đổi `drug.isBatchManaged` khi mặt hàng đang còn tồn kho (bất kỳ kho nào) — chặn để tránh tồn cũ
 * bị "kẹt" dưới khoá lô/phi-lô cũ, không còn nhìn thấy được sau khi đổi cờ (sự cố thật đã gặp với
 * dữ liệu test Playwright, 21/09/2026: 2 dòng tồn theo lô còn nguyên trong khi cờ đã đổi sang
 * phi-lô, phát thuốc báo "không đủ tồn" dù kho có hàng). 409 — xung đột với trạng thái hiện có.
 */
export class DrugBatchManagementChangeBlockedError extends DomainError {
  readonly code = 'DRUG_BATCH_MANAGEMENT_CHANGE_BLOCKED';

  constructor() {
    super('Không thể đổi "Quản lý theo lô" khi mặt hàng đang còn tồn kho — cần xuất/kiểm kê hết tồn trước.');
  }
}

/**
 * Kho Thuốc GĐ5 — ký đơn khi có dòng thuốc vượt tổng tồn kho toàn phòng khám VÀ tenant đã bật
 * "Chặn kê vượt tồn" (`prescriptionStockBlockEnabled=true`). Mặc định (tắt) chỉ CẢNH BÁO MỀM
 * (`prescription.warnings`, kind `stock_insufficient`) — lỗi này chỉ ném khi công tắc đã bật. Không
 * map trong `DOMAIN_ERROR_STATUS` → 422 mặc định, cùng nhóm `STOCK_ISSUE_INSUFFICIENT_STOCK`/
 * `STOCK_TRANSFER_INSUFFICIENT_STOCK` (vi phạm quy tắc nghiệp vụ "đủ tồn", không phải xung đột
 * trạng thái đồng thời).
 */
export class PrescriptionStockInsufficientError extends DomainError {
  readonly code = 'PRESCRIPTION_STOCK_INSUFFICIENT';
  readonly details: { drugId: string; drugName: string; required: number; onHand: number }[];

  constructor(shortages: { drugId: string; drugName: string; required: number; onHand: number }[]) {
    super('Có thuốc trong đơn vượt tồn kho hiện có — không thể ký đơn khi "Chặn kê vượt tồn" đang bật.');
    this.details = shortages;
  }
}

/**
 * "Kê thuốc tự do, không qua danh mục" (mở rộng Kho Thuốc GĐ5) — client gửi dòng
 * `freeTextDrugName` trong khi tenant CHƯA bật `allowFreeTextPrescriptionEnabled`. Chặn bypass qua
 * gọi API thẳng (không qua `DrugPicker.tsx`, nơi nút đã tự ẩn khi tắt). 422 mặc định — vi phạm quy
 * tắc nghiệp vụ, không phải xung đột trạng thái đồng thời.
 */
export class PrescriptionFreeTextDisabledError extends DomainError {
  readonly code = 'PRESCRIPTION_FREE_TEXT_DISABLED';

  constructor() {
    super('Phòng khám chưa bật "Kê thuốc tự do, không qua danh mục" — không thể thêm dòng thuốc ngoài danh mục.');
  }
}
