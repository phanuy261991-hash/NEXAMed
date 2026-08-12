import { describe, expect, it } from 'vitest';
import { ETHNICITY_ITEMS, NATIONALITY_ITEMS } from './data';

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
});
