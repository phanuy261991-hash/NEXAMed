import { DomainError } from './domain-error';

/** DB trả unique violation trên `(category, code)` — trùng mã trong cùng danh mục. */
export class ReferenceCatalogDuplicateCodeError extends DomainError {
  readonly code = 'REFERENCE_CATALOG_DUPLICATE_CODE';

  constructor() {
    super('Mã này đã tồn tại trong danh mục.');
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
