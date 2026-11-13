/**
 * Quy đổi số lượng nhập theo một đơn vị sang ĐƠN VỊ NHỎ NHẤT để hiện gợi ý "= 500 viên" ở form Đơn đặt hàng NCC và Phiếu nhập kho. Chỉ để HIỂN THỊ:
 * số quy đổi thật do máy chủ tính lúc Duyệt phiếu (`computeUnitConversion` ở `packages/core`, docs/DECISIONS.md #275). `apps/web` không import `@nexamed/core` (#073)
 * nên cách tính (tích luỹ `factorToUnitBelow` từ bậc 0 tới bậc đang xét) được lặp lại ở đây; `base-quantity.spec.ts` ghim các ca chính.
 */
export interface UnitLink {
  unitCode: string;
  sortOrder: number;
  factorToUnitBelow: number;
}

/** Số đơn vị NHỎ NHẤT tương đương 1 `unitCode`; `1` với chính đơn vị nhỏ nhất, `null` nếu đơn vị không có trong chuỗi. */
export function factorToBaseUnit(baseUnitCode: string | null, links: readonly UnitLink[], unitCode: string): number | null {
  if (!baseUnitCode || unitCode === baseUnitCode) return 1;
  let cumulative = 1;
  for (const link of [...links].sort((a, b) => a.sortOrder - b.sortOrder)) {
    cumulative *= link.factorToUnitBelow;
    if (link.unitCode === unitCode) return cumulative;
  }
  return null;
}

/** Số lượng nhập (chuỗi hoặc số) → số nguyên dương, hoặc `null` nếu chưa hợp lệ. */
export function parsePositiveQuantity(value: string | number): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
