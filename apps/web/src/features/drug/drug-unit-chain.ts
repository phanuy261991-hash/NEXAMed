/**
 * Kiểm chuỗi quy đổi đơn vị của thuốc/vật tư ngay ở form (docs/DECISIONS.md #275). Máy chủ cũng chặn (`checkUnitChain`, `packages/shared/src/drug.ts`) nhưng chỉ trả câu
 * chung "Dữ liệu gửi lên không hợp lệ" — form báo trước đúng lý do. Hai bản cài đặt phải khớp nhau: cả hai spec đọc `packages/shared/test-vectors/unit-chain-validation.json`.
 * (`apps/web` chỉ import KIỂU từ `@nexamed/shared`, không import được hàm/hằng lúc chạy, nên hằng trần được lặp lại ở đây.)
 */
export const MAX_UNIT_CONVERSION_FACTOR = 1_000_000;

/** Một bậc trong form — hệ số giữ CHUỖI người dùng gõ. */
export interface UnitChainRowInput {
  unitCode: string;
  factorToUnitBelow: string;
}

export interface UnitChainIssue {
  /** Chỉ số bậc (trong các bậc đã nhập đủ) bị lỗi, hoặc `null` nếu lỗi chung của cả chuỗi. */
  row: number | null;
  message: string;
}

/** Bậc đã nhập đủ (có đơn vị VÀ hệ số) — đúng tiêu chí form dùng để gửi lên máy chủ; bậc trống/dở dang bị bỏ qua, không báo lỗi. */
export function completeUnitChainRows<T extends UnitChainRowInput>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.unitCode && r.factorToUnitBelow.trim() !== '');
}

export function validateUnitChain(params: { baseUnitCode: string; rows: readonly UnitChainRowInput[] }): UnitChainIssue[] {
  const rows = completeUnitChainRows(params.rows);
  const issues: UnitChainIssue[] = [];
  const seen = new Set<string>();
  let total = 1;
  let totalValid = true;

  rows.forEach((row, i) => {
    const factorText = row.factorToUnitBelow.trim();
    const factor = /^\d+$/.test(factorText) ? Number(factorText) : NaN;
    if (!Number.isSafeInteger(factor) || factor < 1) {
      issues.push({ row: i, message: 'Hệ số quy đổi phải là số nguyên từ 1 trở lên.' });
      totalValid = false;
    } else {
      total *= factor;
    }

    const code = row.unitCode.trim().toLocaleLowerCase('vi-VN');
    if (params.baseUnitCode && row.unitCode === params.baseUnitCode) {
      issues.push({ row: i, message: 'Đơn vị này trùng với đơn vị nhỏ nhất — chọn đơn vị khác.' });
    } else if (seen.has(code)) {
      issues.push({ row: i, message: 'Đơn vị bị trùng trong bảng quy đổi.' });
    }
    seen.add(code);
  });

  if (totalValid && total > MAX_UNIT_CONVERSION_FACTOR) {
    issues.push({ row: null, message: `Tổng quy đổi ra đơn vị nhỏ nhất không được vượt ${MAX_UNIT_CONVERSION_FACTOR.toLocaleString('vi-VN')}.` });
  }
  return issues;
}
