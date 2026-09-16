import { describe, expect, it } from 'vitest';
import {
  DOSAGE_FORM_ITEMS,
  DRUG_GROUP_ITEMS,
  DRUG_ROUTE_ITEMS,
  EMPLOYMENT_STATUS_ITEMS,
  EMPLOYMENT_TYPE_ITEMS,
  ETHNICITY_ITEMS,
  NATIONALITY_ITEMS,
  OCCUPATION_ITEMS,
} from './data';

describe('reference-catalog seed data', () => {
  it('có đúng 54 dân tộc, không trùng code', () => {
    expect(ETHNICITY_ITEMS).toHaveLength(54);
    expect(new Set(ETHNICITY_ITEMS.map((i) => i.code)).size).toBe(54);
  });

  it('có đúng 30 quốc tịch, không trùng code, Việt Nam đứng đầu', () => {
    expect(NATIONALITY_ITEMS).toHaveLength(30);
    expect(new Set(NATIONALITY_ITEMS.map((i) => i.code)).size).toBe(30);
    expect(NATIONALITY_ITEMS[0]).toMatchObject({ code: 'VNM', name: 'Việt Nam' });
  });

  it('EMPLOYMENT_STATUS_ITEMS: đúng 3 trạng thái, chỉ "Nghỉ việc" tự động vô hiệu hoá', () => {
    expect(EMPLOYMENT_STATUS_ITEMS).toHaveLength(3);
    expect(new Set(EMPLOYMENT_STATUS_ITEMS.map((i) => i.code)).size).toBe(3);
    const deactivating = EMPLOYMENT_STATUS_ITEMS.filter((i) => i.deactivatesAccount === true);
    expect(deactivating).toHaveLength(1);
    expect(deactivating[0]).toMatchObject({ code: 'RESIGNED', name: 'Nghỉ việc' });
  });

  it('EMPLOYMENT_TYPE_ITEMS: đúng 4 hình thức làm việc, không trùng code', () => {
    expect(EMPLOYMENT_TYPE_ITEMS).toHaveLength(4);
    expect(new Set(EMPLOYMENT_TYPE_ITEMS.map((i) => i.code)).size).toBe(4);
  });

  it('OCCUPATION_ITEMS: đúng 13 nghề nghiệp, không trùng code, "Khác" đứng cuối', () => {
    expect(OCCUPATION_ITEMS).toHaveLength(13);
    expect(new Set(OCCUPATION_ITEMS.map((i) => i.code)).size).toBe(13);
    expect(OCCUPATION_ITEMS[OCCUPATION_ITEMS.length - 1]).toMatchObject({ code: 'KHAC', name: 'Khác' });
  });

  it('DRUG_GROUP_ITEMS: đúng 28 nhóm tác dụng dược lý, không trùng code/bytCode, đủ fullName, "Khác" đứng cuối', () => {
    expect(DRUG_GROUP_ITEMS).toHaveLength(28);
    expect(new Set(DRUG_GROUP_ITEMS.map((i) => i.code)).size).toBe(28);
    expect(new Set(DRUG_GROUP_ITEMS.map((i) => i.bytCode)).size).toBe(28);
    expect(DRUG_GROUP_ITEMS.every((i) => i.bytCode)).toBe(true);
    expect(DRUG_GROUP_ITEMS.every((i) => i.fullName)).toBe(true);
    expect(DRUG_GROUP_ITEMS[DRUG_GROUP_ITEMS.length - 1]).toMatchObject({
      code: 'N99',
      bytCode: '99',
      name: 'Khác',
      fullName: 'Nhóm thuốc khác',
    });
  });

  it('DRUG_ROUTE_ITEMS: đúng 18 đường dùng, không trùng code/bytCode, đủ fullName/description, "Khác" đứng cuối', () => {
    expect(DRUG_ROUTE_ITEMS).toHaveLength(18);
    expect(new Set(DRUG_ROUTE_ITEMS.map((i) => i.code)).size).toBe(18);
    expect(new Set(DRUG_ROUTE_ITEMS.map((i) => i.bytCode)).size).toBe(18);
    expect(DRUG_ROUTE_ITEMS.every((i) => i.bytCode)).toBe(true);
    expect(DRUG_ROUTE_ITEMS.every((i) => i.fullName)).toBe(true);
    expect(DRUG_ROUTE_ITEMS.every((i) => i.description)).toBe(true);
    expect(DRUG_ROUTE_ITEMS[DRUG_ROUTE_ITEMS.length - 1]).toMatchObject({
      code: 'U99',
      bytCode: '9',
      name: 'Khác',
      fullName: 'Đường dùng khác',
      description: 'Các đường dùng đặc thù khác',
    });
  });

  it('DOSAGE_FORM_ITEMS: đúng 16 dạng bào chế, không trùng code/bytCode, đủ fullName/description, "Khác" đứng cuối', () => {
    expect(DOSAGE_FORM_ITEMS).toHaveLength(16);
    expect(new Set(DOSAGE_FORM_ITEMS.map((i) => i.code)).size).toBe(16);
    expect(new Set(DOSAGE_FORM_ITEMS.map((i) => i.bytCode)).size).toBe(16);
    expect(DOSAGE_FORM_ITEMS.every((i) => i.bytCode)).toBe(true);
    expect(DOSAGE_FORM_ITEMS.every((i) => i.fullName)).toBe(true);
    expect(DOSAGE_FORM_ITEMS.every((i) => i.description)).toBe(true);
    expect(DOSAGE_FORM_ITEMS[DOSAGE_FORM_ITEMS.length - 1]).toMatchObject({
      code: 'F99',
      bytCode: 'KH',
      name: 'Khác',
      fullName: 'Dạng bào chế khác',
      description: 'Các dạng bào chế đặc biệt khác',
    });
  });
});
