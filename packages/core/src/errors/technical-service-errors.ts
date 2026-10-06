import { DomainError } from './domain-error';

/**
 * DB trả exclusion-constraint violation trên `technical_service_price_no_overlap_excl` (docs/DECISIONS.md #212) —
 * 2 dòng đơn giá cùng dịch vụ kỹ thuật + cùng Loại giá có khoảng ngày hiệu lực chồng lấn nhau, kể cả khi ghi đồng
 * thời. Cùng khuôn `ExamTypePriceOverlapError` (#079).
 */
export class TechnicalServicePriceOverlapError extends DomainError {
  readonly code = 'TECHNICAL_SERVICE_PRICE_OVERLAP';

  constructor() {
    super('Đã có đơn giá khác cùng Loại giá dịch vụ trùng khoảng ngày hiệu lực.');
  }
}

/** Chỉ số xét nghiệm đang được dịch vụ khác dùng — không đổi kiểu giá trị (số/chữ/chọn) khi đã gắn vào dịch vụ. */
export class LabIndicatorValueTypeLockedError extends DomainError {
  readonly code = 'LAB_INDICATOR_VALUE_TYPE_LOCKED';

  constructor() {
    super('Chỉ số đang được dùng trong dịch vụ xét nghiệm — không đổi được Kiểu giá trị.');
  }
}
