import { describe, expect, it } from 'vitest';
import { GENERAL_SPECIALTY_ID, createSpecialtyRegistry } from './registry';

describe('createSpecialtyRegistry', () => {
  it('luôn có sẵn gói "general" mặc định, không cần đăng ký', () => {
    const registry = createSpecialtyRegistry();
    expect(registry.get(GENERAL_SPECIALTY_ID)).toEqual({ id: GENERAL_SPECIALTY_ID, label: 'Khám tổng quát' });
    expect(registry.list()).toHaveLength(1);
  });

  it('đăng ký gói mới → tra được bằng get(), có trong list()', () => {
    const registry = createSpecialtyRegistry();
    registry.register({ id: 'pediatric', label: 'Nhi khoa' });

    expect(registry.get('pediatric')).toEqual({ id: 'pediatric', label: 'Nhi khoa' });
    expect(registry.list().map((p) => p.id).sort()).toEqual(['general', 'pediatric']);
  });

  it('đăng ký trùng id (kể cả trùng với "general") → ném lỗi, không âm thầm ghi đè', () => {
    const registry = createSpecialtyRegistry();
    registry.register({ id: 'pediatric', label: 'Nhi khoa' });

    expect(() => registry.register({ id: 'pediatric', label: 'Nhi khoa (bản khác)' })).toThrow();
    expect(() => registry.register({ id: GENERAL_SPECIALTY_ID, label: 'Khác' })).toThrow();
  });

  it('id không tồn tại → get() trả undefined, không ném lỗi', () => {
    const registry = createSpecialtyRegistry();
    expect(registry.get('không-tồn-tại')).toBeUndefined();
  });

  it('mỗi lần gọi createSpecialtyRegistry() là một instance độc lập — không rò state giữa các registry', () => {
    const a = createSpecialtyRegistry();
    const b = createSpecialtyRegistry();
    a.register({ id: 'dental', label: 'Nha khoa' });

    expect(a.get('dental')).toBeDefined();
    expect(b.get('dental')).toBeUndefined();
  });
});
