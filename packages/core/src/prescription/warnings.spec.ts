import { describe, expect, it } from 'vitest';
import { findAllergyMatches, findDuplicateActiveIngredients, type PrescriptionDrugLine } from './warnings';

describe('findDuplicateActiveIngredients (PRE-02)', () => {
  it('trả về nhóm khi 2 thuốc khác nhau cùng hoạt chất', () => {
    const lines: PrescriptionDrugLine[] = [
      { drugId: '1', drugName: 'Paracetamol 500mg', activeIngredient: 'Paracetamol' },
      { drugId: '2', drugName: 'Efferalgan', activeIngredient: 'paracetamol' },
    ];
    const warnings = findDuplicateActiveIngredients(lines);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.drugIds).toEqual(['1', '2']);
  });

  it('không dấu/hoa thường khác nhau vẫn coi là trùng', () => {
    const lines: PrescriptionDrugLine[] = [
      { drugId: '1', drugName: 'A', activeIngredient: 'Amoxicillin' },
      { drugId: '2', drugName: 'B', activeIngredient: 'AMOXICILLIN' },
    ];
    expect(findDuplicateActiveIngredients(lines)).toHaveLength(1);
  });

  it('chỉ 1 thuốc mỗi hoạt chất → không cảnh báo', () => {
    const lines: PrescriptionDrugLine[] = [
      { drugId: '1', drugName: 'A', activeIngredient: 'Paracetamol' },
      { drugId: '2', drugName: 'B', activeIngredient: 'Amoxicillin' },
    ];
    expect(findDuplicateActiveIngredients(lines)).toHaveLength(0);
  });

  it('bỏ qua dòng không có hoạt chất', () => {
    const lines: PrescriptionDrugLine[] = [
      { drugId: '1', drugName: 'A', activeIngredient: null },
      { drugId: '2', drugName: 'B', activeIngredient: '' },
    ];
    expect(findDuplicateActiveIngredients(lines)).toHaveLength(0);
  });

  it('cùng 1 dòng thuốc lặp lại (cùng drugId) không tự tính là trùng với chính nó', () => {
    const lines: PrescriptionDrugLine[] = [{ drugId: '1', drugName: 'A', activeIngredient: 'Paracetamol' }];
    expect(findDuplicateActiveIngredients(lines)).toHaveLength(0);
  });
});

describe('findAllergyMatches (PRE-03)', () => {
  it('khớp tên thuốc chứa tên dị nguyên (không dấu)', () => {
    const lines: PrescriptionDrugLine[] = [{ drugId: '1', drugName: 'Amoxicillin 500mg', activeIngredient: null }];
    const warnings = findAllergyMatches(lines, ['Amoxicillin']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.drugIds).toEqual(['1']);
  });

  it('khớp qua hoạt chất khi tên thương mại khác', () => {
    const lines: PrescriptionDrugLine[] = [{ drugId: '1', drugName: 'Augmentin', activeIngredient: 'Amoxicillin/Clavulanate' }];
    const warnings = findAllergyMatches(lines, ['Amoxicillin']);
    expect(warnings).toHaveLength(1);
  });

  it('không khớp gì → mảng rỗng', () => {
    const lines: PrescriptionDrugLine[] = [{ drugId: '1', drugName: 'Paracetamol', activeIngredient: 'Paracetamol' }];
    expect(findAllergyMatches(lines, ['Penicillin'])).toHaveLength(0);
  });

  it('không có dị nguyên nào → mảng rỗng, không lỗi', () => {
    const lines: PrescriptionDrugLine[] = [{ drugId: '1', drugName: 'A', activeIngredient: null }];
    expect(findAllergyMatches(lines, [])).toHaveLength(0);
  });

  it('nhiều dòng thuốc cùng khớp 1 dị nguyên gộp vào 1 cảnh báo', () => {
    const lines: PrescriptionDrugLine[] = [
      { drugId: '1', drugName: 'Amoxicillin 500mg', activeIngredient: null },
      { drugId: '2', drugName: 'Amoxicillin 250mg', activeIngredient: null },
    ];
    const warnings = findAllergyMatches(lines, ['Amoxicillin']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.drugIds).toEqual(['1', '2']);
  });
});
