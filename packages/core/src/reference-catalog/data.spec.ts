import { describe, expect, it } from 'vitest';
import { EMPLOYMENT_STATUS_ITEMS, EMPLOYMENT_TYPE_ITEMS, ETHNICITY_ITEMS, NATIONALITY_ITEMS } from './data';

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
});
