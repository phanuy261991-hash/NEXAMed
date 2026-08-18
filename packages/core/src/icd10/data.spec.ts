import { describe, expect, it } from 'vitest';
import { ICD10_ITEMS } from './data';

const EXPECTED_COUNT_BY_CHAPTER: Record<string, number> = {
  I: 924,
  II: 874,
  III: 192,
  IV: 412,
  V: 467,
  VI: 394,
  VII: 307,
  VIII: 135,
  IX: 463,
  X: 289,
  XI: 507,
  XII: 400,
  XIII: 3863,
  XIV: 505,
  XV: 501,
  XVI: 389,
  XVII: 705,
  XVIII: 401,
  XIX: 1742,
  XX: 1549,
  XXI: 713,
  XXII: 112,
};

describe('icd10 seed data (S3-01, mở khoá một phần — đủ Chương I-XXII)', () => {
  it('có đủ 22 Chương, code duy nhất trên toàn bộ danh mục', () => {
    const total = Object.values(EXPECTED_COUNT_BY_CHAPTER).reduce((sum, n) => sum + n, 0);
    expect(ICD10_ITEMS).toHaveLength(total);
    expect(new Set(ICD10_ITEMS.map((i) => i.code)).size).toBe(ICD10_ITEMS.length);
  });

  it('đúng số dòng theo từng Chương I-XXII', () => {
    const byChapter = new Map<string, number>();
    for (const item of ICD10_ITEMS) byChapter.set(item.chapterCode, (byChapter.get(item.chapterCode) ?? 0) + 1);
    for (const [chapterCode, expectedCount] of Object.entries(EXPECTED_COUNT_BY_CHAPTER)) {
      expect(byChapter.get(chapterCode)).toBe(expectedCount);
    }
    expect(byChapter.size).toBe(22);
  });

  it('mọi groupCode đều trỏ tới đúng 1 dòng nhóm có thật (code === groupCode) trong chính mảng', () => {
    const groupCodes = new Set(ICD10_ITEMS.filter((i) => i.code === i.groupCode).map((i) => i.groupCode));
    for (const item of ICD10_ITEMS) {
      expect(groupCodes.has(item.groupCode)).toBe(true);
    }
  });

  it('mã A00 (nhóm) không tính là bệnh chính, mã chi tiết A00.0 tính được', () => {
    const a00 = ICD10_ITEMS.find((i) => i.code === 'A00');
    const a000 = ICD10_ITEMS.find((i) => i.code === 'A00.0');
    expect(a00).toMatchObject({ nameVi: 'Bệnh tả', isBillable: false });
    expect(a000).toMatchObject({ isBillable: true });
  });

  it('không còn ký hiệu chéo †/* trong code (đã tách khỏi PK, xem A06.4† và F00*)', () => {
    expect(ICD10_ITEMS.some((i) => i.code.includes('†') || i.code.includes('*'))).toBe(false);
    const a064 = ICD10_ITEMS.find((i) => i.code === 'A06.4');
    expect(a064).toBeDefined();
    expect(a064?.nameVi).toContain('Áp xe gan do a-míp');
    const f00 = ICD10_ITEMS.find((i) => i.code === 'F00');
    expect(f00).toBeDefined();
    expect(f00?.nameVi).toContain('(G30.-†)');
  });

  it('suy đúng genderRestriction từ ghi chú sử dụng (A34 nữ, B26.0 nam)', () => {
    expect(ICD10_ITEMS.find((i) => i.code === 'A34')?.genderRestriction).toBe('female');
    expect(ICD10_ITEMS.find((i) => i.code === 'B26.0')?.genderRestriction).toBe('male');
  });

  it('suy đúng usageRestriction (B90 vừa không tính bệnh chính đầy đủ vừa hạn chế bệnh chính)', () => {
    const b90 = ICD10_ITEMS.find((i) => i.code === 'B90');
    expect(b90).toMatchObject({ isBillable: false, usageRestriction: 'limited_primary' });
  });

  it('giữ nguyên nội dung trong ngoặc vuông sau khi bỏ escape markdown (B98.0)', () => {
    const b980 = ICD10_ITEMS.find((i) => i.code === 'B98.0');
    expect(b980?.nameVi).toContain('[H.pylori]');
  });

  it('Chương giữa và cuối danh mục có dữ liệu hợp lệ (mẫu: C00 chương II, S00 chương XIX, Z00 chương XXI)', () => {
    expect(ICD10_ITEMS.find((i) => i.code === 'C00')).toMatchObject({ chapterCode: 'II', nameVi: 'U ác tính ở môi' });
    expect(ICD10_ITEMS.find((i) => i.code === 'D50')).toMatchObject({
      chapterCode: 'III',
      nameVi: 'Thiếu máu do thiếu sắt',
    });
    const s00 = ICD10_ITEMS.find((i) => i.code === 'S00');
    expect(s00?.chapterCode).toBe('XIX');
    const z00 = ICD10_ITEMS.find((i) => i.code === 'Z00');
    expect(z00?.chapterCode).toBe('XXI');
  });
});