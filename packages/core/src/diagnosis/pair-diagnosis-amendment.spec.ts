import { describe, expect, it } from 'vitest';
import { pairDiagnosisAmendment } from './pair-diagnosis-amendment';

describe('pairDiagnosisAmendment', () => {
  it('ghép đúng dòng mới với dòng cũ cùng (icd10Code, type)', () => {
    const old = [{ id: 'old-1', icd10Code: 'A00', type: 'PRIMARY' as const }];
    const result = pairDiagnosisAmendment(old, [{ icd10Code: 'A00', type: 'PRIMARY', note: null }]);
    expect(result).toEqual([{ icd10Code: 'A00', type: 'PRIMARY', note: null, supersedesId: 'old-1' }]);
  });

  it('mã mới hoàn toàn (không khớp dòng cũ nào) → supersedesId=null', () => {
    const old = [{ id: 'old-1', icd10Code: 'A00', type: 'PRIMARY' as const }];
    const result = pairDiagnosisAmendment(old, [{ icd10Code: 'B01', type: 'PRIMARY', note: null }]);
    expect(result).toEqual([{ icd10Code: 'B01', type: 'PRIMARY', note: null, supersedesId: null }]);
  });

  it('đổi type của cùng mã (PRIMARY→SECONDARY) không coi là cùng dòng — supersedesId=null', () => {
    const old = [{ id: 'old-1', icd10Code: 'A00', type: 'PRIMARY' as const }];
    const result = pairDiagnosisAmendment(old, [{ icd10Code: 'A00', type: 'SECONDARY', note: null }]);
    expect(result[0]!.supersedesId).toBeNull();
  });

  it('dòng cũ bị bỏ (không có trong danh sách mới) — không xuất hiện trong kết quả', () => {
    const old = [
      { id: 'old-1', icd10Code: 'A00', type: 'PRIMARY' as const },
      { id: 'old-2', icd10Code: 'B01', type: 'SECONDARY' as const },
    ];
    const result = pairDiagnosisAmendment(old, [{ icd10Code: 'A00', type: 'PRIMARY', note: null }]);
    expect(result).toHaveLength(1);
    expect(result[0]!.supersedesId).toBe('old-1');
  });

  it('trùng mã+type ở cả cũ và mới (2 dòng) — ghép 1-1 theo thứ tự, không ghép lại cùng 1 dòng cũ 2 lần', () => {
    const old = [
      { id: 'old-1', icd10Code: 'A00', type: 'SECONDARY' as const },
      { id: 'old-2', icd10Code: 'A00', type: 'SECONDARY' as const },
    ];
    const result = pairDiagnosisAmendment(old, [
      { icd10Code: 'A00', type: 'SECONDARY', note: null },
      { icd10Code: 'A00', type: 'SECONDARY', note: null },
    ]);
    expect(result.map((r) => r.supersedesId).sort()).toEqual(['old-1', 'old-2']);
  });
});
