import { describe, expect, it } from 'vitest';
import { MAX_UNIT_CONVERSION_FACTOR, updateDrugRequestSchema } from './drug';

/** Chuỗi quy đổi đơn vị (docs/DECISIONS.md #275) — kiểm qua schema cập nhật (chỉ cần `version`). */
function parseUnits(units: { unitCode: string; sortOrder: number; factorToUnitBelow: number }[], baseUnitCode?: string) {
  return updateDrugRequestSchema.safeParse({ version: 1, units, ...(baseUnitCode ? { baseUnitCode } : {}) });
}

function messagesOf(result: ReturnType<typeof parseUnits>): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe('drug schema — chuỗi quy đổi đơn vị hợp lệ', () => {
  it('chuỗi Vỉ→Hộp hợp lệ qua', () => {
    const r = parseUnits(
      [
        { unitCode: 'VI', sortOrder: 0, factorToUnitBelow: 10 },
        { unitCode: 'HOP', sortOrder: 1, factorToUnitBelow: 10 },
      ],
      'VIEN',
    );
    expect(r.success).toBe(true);
  });

  it('chuỗi rỗng và payload không có units (không đổi) đều qua', () => {
    expect(parseUnits([], 'VIEN').success).toBe(true);
    expect(updateDrugRequestSchema.safeParse({ version: 1 }).success).toBe(true);
  });

  it('trùng mã đơn vị trong chuỗi (kể cả khác hoa/thường) bị chặn', () => {
    const r = parseUnits([
      { unitCode: 'HOP', sortOrder: 0, factorToUnitBelow: 10 },
      { unitCode: 'hop', sortOrder: 1, factorToUnitBelow: 2 },
    ]);
    expect(messagesOf(r)).toContain('Đơn vị bị trùng trong bảng quy đổi.');
  });

  it('đơn vị trùng đơn vị nhỏ nhất bị chặn', () => {
    const r = parseUnits([{ unitCode: 'VIEN', sortOrder: 0, factorToUnitBelow: 10 }], 'VIEN');
    expect(messagesOf(r)).toContain('Đơn vị này trùng với đơn vị nhỏ nhất — chọn đơn vị khác.');
  });

  it('trùng thứ tự bậc bị chặn (DB có unique (drug, sort_order))', () => {
    const r = parseUnits([
      { unitCode: 'VI', sortOrder: 0, factorToUnitBelow: 10 },
      { unitCode: 'HOP', sortOrder: 0, factorToUnitBelow: 10 },
    ]);
    expect(messagesOf(r)).toContain('Thứ tự bậc bị trùng trong bảng quy đổi.');
  });

  it('tổng hệ số bằng đúng trần thì qua, vượt trần 1 đơn vị thì bị chặn', () => {
    const atCap = parseUnits([
      { unitCode: 'A', sortOrder: 0, factorToUnitBelow: 1000 },
      { unitCode: 'B', sortOrder: 1, factorToUnitBelow: 1000 },
    ]);
    expect(MAX_UNIT_CONVERSION_FACTOR).toBe(1_000_000);
    expect(atCap.success).toBe(true);

    const overCap = parseUnits([
      { unitCode: 'A', sortOrder: 0, factorToUnitBelow: 1000 },
      { unitCode: 'B', sortOrder: 1, factorToUnitBelow: 1001 },
    ]);
    expect(overCap.success).toBe(false);
    expect(messagesOf(overCap).some((m) => m.startsWith('Tổng quy đổi ra đơn vị nhỏ nhất không được vượt'))).toBe(true);
  });
});
