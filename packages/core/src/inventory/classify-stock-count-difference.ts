export type StockCountDifferenceKind = 'SURPLUS' | 'SHORTAGE' | 'MATCH';

export interface StockCountDifferenceResult {
  difference: number;
  kind: StockCountDifferenceKind;
}

/**
 * So sánh số đếm thực tế với tồn kho SỐNG (đọc lại `stock_balance` tại thời điểm Duyệt, không dùng
 * `systemQuantitySnapshot` cũ lưu trên dòng) — dùng cho Kiểm kê kho (Kho Thuốc GĐ4, docs/DECISIONS.md
 * #170). `difference = countedQuantity - liveQuantity`: dương là DƯ (sinh `StockReceipt`
 * `COUNT_SURPLUS`), âm là THIẾU (sinh `StockIssue` `COUNT_SHORTAGE`), 0 là khớp (không sinh gì).
 */
export function classifyStockCountDifference(countedQuantity: number, liveQuantity: number): StockCountDifferenceResult {
  const difference = countedQuantity - liveQuantity;
  const kind: StockCountDifferenceKind = difference > 0 ? 'SURPLUS' : difference < 0 ? 'SHORTAGE' : 'MATCH';
  return { difference, kind };
}
