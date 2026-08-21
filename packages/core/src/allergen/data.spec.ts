import { describe, expect, it } from 'vitest';
import { ALLERGEN_CATALOG_SEED } from './data';

describe('ALLERGEN_CATALOG_SEED (docs/data/allergen-catalog.md)', () => {
  it('đủ 7 nhóm, đúng thứ tự xuất hiện lần đầu trong file gốc', () => {
    expect(ALLERGEN_CATALOG_SEED.map((g) => g.groupName)).toEqual([
      'Thuốc',
      'Thực phẩm',
      'Môi trường',
      'Động vật',
      'Côn trùng',
      'Tiếp xúc',
      'Khác',
    ]);
  });

  it('tổng đúng 150 dị nguyên (khớp số dòng dữ liệu trong file gốc, trừ header)', () => {
    const total = ALLERGEN_CATALOG_SEED.reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(150);
  });

  it('không nhóm nào rỗng, không tên nào trùng lặp TRONG cùng một nhóm', () => {
    for (const group of ALLERGEN_CATALOG_SEED) {
      expect(group.items.length).toBeGreaterThan(0);
      expect(new Set(group.items).size).toBe(group.items.length);
    }
  });

  it('không tên nhóm nào trùng lặp (mỗi nhóm chỉ xuất hiện đúng 1 lần trong mảng, kể cả "Môi trường" xuất hiện 2 đoạn rời nhau trong file gốc)', () => {
    const groupNames = ALLERGEN_CATALOG_SEED.map((g) => g.groupName);
    expect(new Set(groupNames).size).toBe(groupNames.length);
  });
});
