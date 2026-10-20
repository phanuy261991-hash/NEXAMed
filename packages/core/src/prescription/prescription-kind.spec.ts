import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESCRIPTION_KIND_MAPPING,
  groupByPrescriptionKind,
  resolvePrescriptionKind,
  type PrescriptionKindMapping,
} from './prescription-kind';

describe('resolvePrescriptionKind — ánh xạ mặc định', () => {
  const kind = (controlType: Parameters<typeof resolvePrescriptionKind>[0]['controlType'], isTraditional = false) =>
    resolvePrescriptionKind({ isFreeText: false, controlType, isTraditional });

  it('gây nghiện → N; hướng thần và tiền chất → H; thuốc độc và thường → C', () => {
    expect(kind('NARCOTIC')).toBe('N');
    expect(kind('PSYCHOTROPIC')).toBe('H');
    expect(kind('PRECURSOR')).toBe('H');
    expect(kind('TOXIC')).toBe('C');
    expect(kind('NORMAL')).toBe('C');
  });

  it('thiếu controlType coi như thuốc thường (C)', () => {
    expect(resolvePrescriptionKind({ isFreeText: false })).toBe('C');
    expect(resolvePrescriptionKind({ isFreeText: false, controlType: null })).toBe('C');
  });

  it('cờ Đông y → Y (thuốc thường), còn thuốc kiểm soát đặc biệt thắng theo thứ tự N, H, Y, C', () => {
    expect(kind('NORMAL', true)).toBe('Y');
    expect(kind('TOXIC', true)).toBe('Y');
    expect(kind('NARCOTIC', true)).toBe('N');
    expect(kind('PSYCHOTROPIC', true)).toBe('H');
    expect(kind('PRECURSOR', true)).toBe('H');
  });

  it('dòng kê tự do luôn là C, kể cả khi truyền kèm loại thuốc kiểm soát', () => {
    expect(resolvePrescriptionKind({ isFreeText: true, controlType: 'NARCOTIC', isTraditional: true })).toBe('C');
  });
});

describe('resolvePrescriptionKind — ánh xạ do phòng khám sửa', () => {
  const custom: PrescriptionKindMapping = { ...DEFAULT_PRESCRIPTION_KIND_MAPPING, TOXIC: 'H', TRADITIONAL: 'C', PRECURSOR: 'C' };

  it('dùng ánh xạ truyền vào thay cho mặc định', () => {
    expect(resolvePrescriptionKind({ isFreeText: false, controlType: 'TOXIC' }, custom)).toBe('H');
    expect(resolvePrescriptionKind({ isFreeText: false, controlType: 'PRECURSOR' }, custom)).toBe('C');
    expect(resolvePrescriptionKind({ isFreeText: false, controlType: 'NORMAL', isTraditional: true }, custom)).toBe('C');
  });

  it('thứ tự ưu tiên vẫn áp dụng trên kết quả sau ánh xạ', () => {
    expect(resolvePrescriptionKind({ isFreeText: false, controlType: 'TOXIC', isTraditional: true }, custom)).toBe('H');
  });
});

describe('groupByPrescriptionKind', () => {
  it('nhóm theo thứ tự C, N, H, Y, bỏ nhóm rỗng, giữ thứ tự dòng trong nhóm', () => {
    const items = [
      { id: 1, kind: 'Y' as const },
      { id: 2, kind: 'C' as const },
      { id: 3, kind: 'N' as const },
      { id: 4, kind: 'C' as const },
      { id: 5, kind: 'Y' as const },
    ];
    expect(groupByPrescriptionKind(items).map((g) => [g.kind, g.items.map((i) => i.id)])).toEqual([
      ['C', [2, 4]],
      ['N', [3]],
      ['Y', [1, 5]],
    ]);
  });

  it('không có dòng nào → không có nhóm; chỉ một loại → một nhóm', () => {
    expect(groupByPrescriptionKind([])).toEqual([]);
    expect(groupByPrescriptionKind([{ kind: 'C' as const }, { kind: 'C' as const }])).toHaveLength(1);
  });
});
