import { describe, expect, it } from 'vitest';
import { findAllergyMatches, findDuplicateActiveIngredients, findNonSplittableFractionalDoses, type PrescriptionDrugLine } from './warnings';

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

  it('mỗi nhóm trùng có khoá chuẩn hoá (bỏ dấu, viết thường) để "Bỏ qua cảnh báo này"', () => {
    const lines: PrescriptionDrugLine[] = [
      { drugId: '1', drugName: 'A', activeIngredient: 'Amoxicillin' },
      { drugId: '2', drugName: 'B', activeIngredient: 'AMOXICILLIN' },
    ];
    expect(findDuplicateActiveIngredients(lines)[0]!.key).toBe('amoxicillin');
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

  describe('hoạt chất có cấu trúc (drug_ingredient, Kho Thuốc GĐ1)', () => {
    it('so theo tên hoạt chất chuẩn, bỏ qua `activeIngredient` text khác nhau giữa các thuốc', () => {
      const lines: PrescriptionDrugLine[] = [
        { drugId: '1', drugName: 'Panadol', activeIngredient: 'Acetaminophen', ingredientNames: ['Paracetamol'] },
        { drugId: '2', drugName: 'Efferalgan', activeIngredient: null, ingredientNames: ['paracetamol'] },
      ];
      const warnings = findDuplicateActiveIngredients(lines);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.drugIds).toEqual(['1', '2']);
    });

    it('thuốc phối hợp A+B trùng với thuốc đơn B → báo đúng hoạt chất B (không báo A)', () => {
      const lines: PrescriptionDrugLine[] = [
        { drugId: '1', drugName: 'Augmentin', activeIngredient: null, ingredientNames: ['Amoxicillin', 'Acid clavulanic'] },
        { drugId: '2', drugName: 'Amoxil', activeIngredient: null, ingredientNames: ['Amoxicillin'] },
      ];
      const warnings = findDuplicateActiveIngredients(lines);
      expect(warnings.map((w) => w.activeIngredient)).toEqual(['Amoxicillin']);
      expect(warnings[0]!.drugNames).toEqual(['Augmentin', 'Amoxil']);
    });

    it('thuốc có cấu trúc trùng với thuốc cũ chỉ có `activeIngredient` text (tên khớp sau chuẩn hoá) vẫn báo', () => {
      const lines: PrescriptionDrugLine[] = [
        { drugId: '1', drugName: 'Thuốc mới', activeIngredient: null, ingredientNames: ['Cetirizin'] },
        { drugId: '2', drugName: 'Thuốc cũ', activeIngredient: 'CETIRIZIN' },
      ];
      expect(findDuplicateActiveIngredients(lines)).toHaveLength(1);
    });

    it('có cấu trúc thì BỎ QUA `activeIngredient` text của chính dòng đó; danh sách rỗng thì quay về text', () => {
      const lines: PrescriptionDrugLine[] = [
        { drugId: '1', drugName: 'A', activeIngredient: 'Paracetamol', ingredientNames: ['Ibuprofen'] },
        { drugId: '2', drugName: 'B', activeIngredient: 'Paracetamol', ingredientNames: [] },
      ];
      expect(findDuplicateActiveIngredients(lines)).toHaveLength(0);
      const lines2: PrescriptionDrugLine[] = [
        { drugId: '1', drugName: 'A', activeIngredient: 'Paracetamol', ingredientNames: [] },
        { drugId: '2', drugName: 'B', activeIngredient: 'Paracetamol' },
      ];
      expect(findDuplicateActiveIngredients(lines2)).toHaveLength(1);
    });
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

describe('findNonSplittableFractionalDoses (#241)', () => {
  it('thuốc không chia được mà kê liều lẻ thì báo', () => {
    expect(findNonSplittableFractionalDoses([{ drugId: 'a', drugName: 'Amoxicillin', isSplittable: false, hasFractionalDose: true }])).toEqual([{ drugId: 'a', drugName: 'Amoxicillin' }]);
  });
  it('thuốc không chia được nhưng liều nguyên thì không báo', () => {
    expect(findNonSplittableFractionalDoses([{ drugId: 'a', drugName: 'A', isSplittable: false, hasFractionalDose: false }])).toEqual([]);
  });
  it('thuốc chia được kê liều lẻ thì không báo', () => {
    expect(findNonSplittableFractionalDoses([{ drugId: 'a', drugName: 'A', isSplittable: true, hasFractionalDose: true }])).toEqual([]);
  });
  it('dòng kê thuốc tự do (drugId null) không bao giờ báo', () => {
    expect(findNonSplittableFractionalDoses([{ drugId: null, drugName: 'Thuốc ngoài', isSplittable: false, hasFractionalDose: true }])).toEqual([]);
  });
});
