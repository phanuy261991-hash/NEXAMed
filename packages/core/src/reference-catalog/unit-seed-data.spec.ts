import { describe, expect, it } from 'vitest';
import { UNIT_SEED_ITEMS } from './unit-seed-data';

describe('UNIT_SEED_ITEMS', () => {
  it('có đúng 47 đơn vị, không trùng tên (file gốc 48 dòng nhưng "Gói" lặp lại 1 lần)', () => {
    expect(UNIT_SEED_ITEMS).toHaveLength(47);
    expect(new Set(UNIT_SEED_ITEMS.map((i) => i.name)).size).toBe(47);
  });

  it('mọi mục đều có description (ký hiệu viết tắt, không rỗng)', () => {
    for (const item of UNIT_SEED_ITEMS) {
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it('giữ đúng ký hiệu viết tắt cho đơn vị đo lường', () => {
    expect(UNIT_SEED_ITEMS.find((i) => i.name === 'Microgam')).toMatchObject({ description: 'µg' });
    expect(UNIT_SEED_ITEMS.find((i) => i.name === 'Mililit')).toMatchObject({ description: 'mL' });
  });
});
