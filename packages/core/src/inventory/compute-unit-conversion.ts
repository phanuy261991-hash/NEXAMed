/**
 * Kho Thuốc & Vật tư y tế, Giai đoạn 1 (docs/DECISIONS.md #146) — chuỗi quy đổi đơn vị N bậc
 * (`drug_unit`). Mỗi dòng lưu hệ số quy đổi ra bậc NGAY DƯỚI (`sortOrder` 0 = bậc ngay trên đơn vị
 * nhỏ nhất), ví dụ dòng "Vỉ" (sortOrder 0) lưu `factorToUnitBelow=10` nghĩa là 1 Vỉ = 10 (đơn vị
 * nhỏ nhất); dòng "Hộp" (sortOrder 1) lưu `factorToUnitBelow=10` nghĩa là 1 Hộp = 10 Vỉ. Tổng quy
 * đổi ra đơn vị nhỏ nhất là TÍCH LUỸ các `factorToUnitBelow` từ bậc 0 tới bậc đang xét — hàm thuần
 * này tính lại mỗi lần đọc, KHÔNG lưu cột tổng (tránh 2 nguồn sự thật, cùng nguyên tắc
 * `exam_type_price` không lưu số tiền đã tính).
 */

export interface DrugUnitChainLink {
  unitCode: string;
  sortOrder: number;
  factorToUnitBelow: number;
}

export interface UnitConversionLevel {
  unitCode: string;
  /** Số lượng đơn vị NHỎ NHẤT tương đương với 1 đơn vị ở bậc này. */
  factorToBaseUnit: number;
}

/**
 * Trả về bảng quy đổi đầy đủ, từ đơn vị nhỏ nhất (`factorToBaseUnit=1`) tới bậc cao nhất, đã sắp
 * theo `sortOrder`. `links` không cần sắp sẵn — hàm tự sắp theo `sortOrder` trước khi tích luỹ.
 */
export function computeUnitConversion(baseUnitCode: string, links: readonly DrugUnitChainLink[]): UnitConversionLevel[] {
  const sorted = [...links].sort((a, b) => a.sortOrder - b.sortOrder);
  const levels: UnitConversionLevel[] = [{ unitCode: baseUnitCode, factorToBaseUnit: 1 }];
  let cumulative = 1;
  for (const link of sorted) {
    cumulative *= link.factorToUnitBelow;
    levels.push({ unitCode: link.unitCode, factorToBaseUnit: cumulative });
  }
  return levels;
}

/** Quy đổi một số lượng ở `fromUnitCode` sang số lượng tương đương ở đơn vị nhỏ nhất. `null` nếu `fromUnitCode` không có trong bảng quy đổi. */
export function convertToBaseUnitQuantity(baseUnitCode: string, links: readonly DrugUnitChainLink[], fromUnitCode: string, quantity: number): number | null {
  const level = computeUnitConversion(baseUnitCode, links).find((l) => l.unitCode === fromUnitCode);
  return level ? quantity * level.factorToBaseUnit : null;
}
