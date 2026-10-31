import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { completeUnitChainRows, MAX_UNIT_CONVERSION_FACTOR, validateUnitChain } from './drug-unit-chain';

interface Vector {
  name: string;
  baseUnitCode: string;
  units: { unitCode: string; factorToUnitBelow: number }[];
  messages: string[];
}

const { cases } = JSON.parse(readFileSync(join(__dirname, '../../../../../packages/shared/test-vectors/unit-chain-validation.json'), 'utf8')) as { cases: Vector[] };

describe('validateUnitChain (web) — bộ ca dùng chung với máy chủ (packages/shared)', () => {
  it('đọc được bộ ca', () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
  });

  it.each(cases)('$name', ({ baseUnitCode, units, messages }) => {
    const rows = units.map((u) => ({ unitCode: u.unitCode, factorToUnitBelow: String(u.factorToUnitBelow) }));
    const actual = [...new Set(validateUnitChain({ baseUnitCode, rows }).map((i) => i.message))].sort();
    expect(actual).toEqual([...messages].sort());
  });

  it('hằng trần khớp bản máy chủ', () => {
    expect(MAX_UNIT_CONVERSION_FACTOR).toBe(1_000_000);
  });
});

describe('validateUnitChain (web) — riêng form', () => {
  it('bậc trống hoặc dở dang (thiếu đơn vị hay hệ số) bị bỏ qua, không báo lỗi', () => {
    const rows = [
      { unitCode: '', factorToUnitBelow: '' },
      { unitCode: 'VI', factorToUnitBelow: '' },
      { unitCode: '', factorToUnitBelow: '10' },
    ];
    expect(completeUnitChainRows(rows)).toEqual([]);
    expect(validateUnitChain({ baseUnitCode: 'VIEN', rows })).toEqual([]);
  });

  it.each(['0', '-3', '2,5', '1.5', 'abc', '99999999999999999999'])('hệ số %j không hợp lệ → báo đúng bậc đó', (factorToUnitBelow) => {
    const issues = validateUnitChain({ baseUnitCode: 'VIEN', rows: [{ unitCode: 'VI', factorToUnitBelow }] });
    expect(issues).toEqual([{ row: 0, message: 'Hệ số quy đổi phải là số nguyên từ 1 trở lên.' }]);
  });

  it('lỗi gắn đúng chỉ số bậc (tính trên các bậc đã nhập đủ)', () => {
    const issues = validateUnitChain({
      baseUnitCode: 'VIEN',
      rows: [
        { unitCode: '', factorToUnitBelow: '' },
        { unitCode: 'VI', factorToUnitBelow: '10' },
        { unitCode: 'VIEN', factorToUnitBelow: '10' },
      ],
    });
    expect(issues).toEqual([{ row: 1, message: 'Đơn vị này trùng với đơn vị nhỏ nhất — chọn đơn vị khác.' }]);
  });
});
