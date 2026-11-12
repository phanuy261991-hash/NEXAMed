import { describe, expect, it } from 'vitest';
import type { ConsumptionService, ServiceNormLine } from '@nexamed/shared';
import {
  addDraftLine,
  consumptionTargetKey,
  draftFromNorm,
  parseQuantity,
  removeDraftLine,
  sameDraftLines,
  servicesMissingRecord,
  toRequestLines,
  updateDraftQuantity,
  validateDraftLines,
  type ConsumptionPickItem,
} from './consumption-model';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';

const pick = (id: string, name: string): ConsumptionPickItem => ({ id, code: `C-${name}`, name, itemType: 'SUPPLY', baseUnitCode: 'DV1' });

const normLine = (drugId: string, quantity: number): ServiceNormLine => ({ drugId, drugCode: 'C', drugName: `Hàng ${drugId.slice(0, 2)}`, itemType: 'SUPPLY', baseUnitCode: 'DV1', quantity });

function service(partial: Partial<ConsumptionService>): ConsumptionService {
  return {
    target: { kind: 'CLINICAL_ORDER_ITEM', id: D1 },
    serviceKind: 'TECHNICAL_SERVICE',
    serviceCode: null,
    serviceName: 'Lấy máu',
    status: null,
    norm: [],
    record: null,
    ...partial,
  };
}

describe('parseQuantity', () => {
  it('chấp nhận số nguyên dương trong giới hạn', () => {
    expect(parseQuantity('1')).toBe(1);
    expect(parseQuantity(' 30 ')).toBe(30);
    expect(parseQuantity('1000000')).toBe(1_000_000);
  });
  it('từ chối rỗng, 0, âm, số lẻ, chữ, quá lớn', () => {
    for (const bad of ['', ' ', '0', '-1', '1,5', '1.5', 'abc', '1000001', '00']) expect(parseQuantity(bad), bad).toBeNull();
  });
});

describe('dòng soạn', () => {
  it('điền sẵn từ định mức, số lượng thành chữ', () => {
    const lines = draftFromNorm([normLine(D1, 2), normLine(D2, 5)]);
    expect(lines.map((l) => l.quantity)).toEqual(['2', '5']);
  });
  it('thêm mặt hàng mới số lượng 1; trùng mặt hàng thì giữ nguyên', () => {
    const one = addDraftLine([], pick(D1, 'A'));
    expect(one).toHaveLength(1);
    expect(one[0]?.quantity).toBe('1');
    expect(addDraftLine(one, pick(D1, 'A'))).toBe(one);
    expect(addDraftLine(one, pick(D2, 'B'))).toHaveLength(2);
  });
  it('xoá và sửa số lượng đúng dòng', () => {
    const lines = addDraftLine(addDraftLine([], pick(D1, 'A')), pick(D2, 'B'));
    expect(removeDraftLine(lines, D1).map((l) => l.drugId)).toEqual([D2]);
    expect(updateDraftQuantity(lines, D2, '7').map((l) => l.quantity)).toEqual(['1', '7']);
  });
});

describe('validateDraftLines', () => {
  const ok = addDraftLine([], pick(D1, 'A'));
  it('định mức được để trống, ghi tiêu hao thì không', () => {
    expect(validateDraftLines([], { allowEmpty: true })).toBeNull();
    expect(validateDraftLines([], { allowEmpty: false })).toMatch(/ít nhất 1/);
  });
  it('báo tên mặt hàng có số lượng sai', () => {
    const bad = updateDraftQuantity(ok, D1, '0');
    expect(validateDraftLines(bad, { allowEmpty: false })).toContain('"A"');
    expect(validateDraftLines(updateDraftQuantity(ok, D1, ''), { allowEmpty: true })).toContain('"A"');
  });
  it('chặn quá 50 dòng', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...ok[0]!, drugId: `id-${i}` }));
    expect(validateDraftLines(many, { allowEmpty: false })).toMatch(/50/);
    expect(validateDraftLines(many.slice(0, 50), { allowEmpty: false })).toBeNull();
  });
  it('hợp lệ thì trả null và đổi sang số khi gửi', () => {
    expect(validateDraftLines(ok, { allowEmpty: false })).toBeNull();
    expect(toRequestLines(updateDraftQuantity(ok, D1, '12'))).toEqual([{ drugId: D1, quantity: 12 }]);
  });
});

describe('sameDraftLines', () => {
  it('không phân biệt thứ tự và khoảng trắng; khác số lượng hoặc mặt hàng thì khác', () => {
    const a = addDraftLine(addDraftLine([], pick(D1, 'A')), pick(D2, 'B'));
    const b = [...a].reverse();
    expect(sameDraftLines(a, b)).toBe(true);
    expect(sameDraftLines(a, updateDraftQuantity(a, D1, ' 1 '))).toBe(true);
    expect(sameDraftLines(a, updateDraftQuantity(a, D1, '2'))).toBe(false);
    expect(sameDraftLines(a, removeDraftLine(a, D2))).toBe(false);
  });
});

describe('servicesMissingRecord', () => {
  it('chỉ lấy dịch vụ có định mức mà chưa ghi', () => {
    const withNorm = service({ norm: [normLine(D1, 1)] });
    const withNormRecorded = service({ target: { kind: 'CLINICAL_ORDER_ITEM', id: D2 }, norm: [normLine(D1, 1)], record: { id: D1, issueNo: 'X', occurredAt: '', performedBy: D1, performedByName: 'A', warehouseName: 'Kho chính', lines: [], totalCost: null } });
    const noNorm = service({ target: { kind: 'ENCOUNTER_SERVICE_ITEM', id: D2 } });
    expect(servicesMissingRecord([withNorm, withNormRecorded, noNorm])).toEqual([withNorm]);
  });
  it('khoá lượt dịch vụ gồm loại và id', () => {
    expect(consumptionTargetKey({ kind: 'ENCOUNTER_SERVICE_ITEM', id: D1 })).toBe(`ENCOUNTER_SERVICE_ITEM:${D1}`);
  });
});
