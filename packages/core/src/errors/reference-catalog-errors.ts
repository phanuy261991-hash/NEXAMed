import { DomainError } from './domain-error';

/** DB trả unique violation trên `(category, code)` — trùng mã trong cùng danh mục. */
export class ReferenceCatalogDuplicateCodeError extends DomainError {
  readonly code = 'REFERENCE_CATALOG_DUPLICATE_CODE';

  constructor() {
    super('Mã này đã tồn tại trong danh mục.');
  }
}

/** `code` của mục `ICD10_ABBREVIATION` (#206) không phải đúng MỘT từ chữ/số — bộ tách cụm của "Gợi ý
 * mã ICD-10" khớp nguyên từ nên mục như "t.h.a"/"tăng HA" sẽ không bao giờ có tác dụng. Không có trong
 * bảng ánh xạ HTTP ở `domain-exception.filter.ts` nên rơi về mặc định 422 (vi phạm quy tắc nghiệp vụ). */
export class ReferenceCatalogInvalidAbbreviationError extends DomainError {
  readonly code = 'REFERENCE_CATALOG_INVALID_ABBREVIATION';

  constructor() {
    super('Từ viết tắt phải là MỘT từ (chỉ chữ hoặc số, không khoảng trắng/dấu câu), ví dụ "THA", "ĐTĐ".');
  }
}

/** `code` của mục `TREATMENT_FORM` (Hình thức điều trị, #242 GĐ3) phải là MÃ SỐ do Bộ Y tế ban hành — cổng đơn thuốc quốc gia chỉ nhận giá trị số. 422 mặc định. */
export class ReferenceCatalogInvalidTreatmentFormCodeError extends DomainError {
  readonly code = 'REFERENCE_CATALOG_INVALID_TREATMENT_FORM_CODE';

  constructor() {
    super('Mã hình thức điều trị phải là số (tối đa 9 chữ số) theo danh mục của Bộ Y tế, ví dụ 1, 2, 3.');
  }
}

/** Đặt "Mặc định" cho mục không phải Loại giá dịch vụ, hoặc cho mục đã ẩn (docs/DECISIONS.md #268) — Tiếp nhận chỉ liệt kê Loại giá đang dùng nên mục ẩn không thể làm mặc định. 422 mặc định. */
export class ReferenceCatalogDefaultNotAllowedError extends DomainError {
  readonly code = 'REFERENCE_CATALOG_DEFAULT_NOT_ALLOWED';

  constructor() {
    super('Chỉ đặt được mặc định cho Loại giá dịch vụ đang sử dụng.');
  }
}

/** DB trả exclusion-constraint violation trên `exam_type_price_no_overlap_excl` (C20,
 * docs/DECISIONS.md #079) — 2 dòng đơn giá cùng dịch vụ khám + cùng Loại giá dịch vụ có khoảng
 * ngày hiệu lực chồng lấn nhau, kể cả khi ghi đồng thời. Cùng tinh thần `AppointmentSlotConflictError`. */
export class ExamTypePriceOverlapError extends DomainError {
  readonly code = 'EXAM_TYPE_PRICE_OVERLAP';

  constructor() {
    super('Đã có đơn giá khác cùng Loại giá dịch vụ trùng khoảng ngày hiệu lực.');
  }
}
