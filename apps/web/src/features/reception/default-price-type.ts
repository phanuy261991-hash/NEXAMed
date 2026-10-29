import { isDateRangeActiveToday } from '../../shared/format/date';

/** Một dòng đơn giá của dịch vụ khám — chỉ phần cần để chọn sẵn Loại giá. */
export interface DatedExamTypePrice {
  priceTypeCode: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

/**
 * Loại giá dịch vụ chọn sẵn ở Tiếp nhận (docs/DECISIONS.md #268): Loại giá MẶC ĐỊNH của phòng khám, nhưng CHỈ khi dịch vụ vừa chọn có đơn giá
 * HIỆU LỰC HÔM NAY cho đúng mức đó. Thiếu thì trả chuỗi rỗng — để lễ tân tự chọn, KHÔNG tự nhảy sang mức khác (tự đoán mức sẽ thu sai tiền âm thầm).
 */
export function pickInitialPriceTypeCode(defaultPriceTypeCode: string, prices: readonly DatedExamTypePrice[], today: string): string {
  if (defaultPriceTypeCode === '') return '';
  const available = prices.some((p) => p.priceTypeCode === defaultPriceTypeCode && isDateRangeActiveToday(p.effectiveFrom, p.effectiveTo, today));
  return available ? defaultPriceTypeCode : '';
}
