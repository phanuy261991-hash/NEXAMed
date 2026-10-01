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

/** DB trả exclusion-constraint violation trên `exam_type_price_no_overlap_excl` (C20,
 * docs/DECISIONS.md #079) — 2 dòng đơn giá cùng dịch vụ khám + cùng Loại giá dịch vụ có khoảng
 * ngày hiệu lực chồng lấn nhau, kể cả khi ghi đồng thời. Cùng tinh thần `AppointmentSlotConflictError`. */
export class ExamTypePriceOverlapError extends DomainError {
  readonly code = 'EXAM_TYPE_PRICE_OVERLAP';

  constructor() {
    super('Đã có đơn giá khác cùng Loại giá dịch vụ trùng khoảng ngày hiệu lực.');
  }
}
