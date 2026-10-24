import { describe, expect, it } from 'vitest';
import { isScopeAtLeast } from './scope-rank';

describe('isScopeAtLeast', () => {
  it('không có quyền (undefined/none) không đạt bất kỳ mức tối thiểu nào ngoài none', () => {
    expect(isScopeAtLeast(undefined, 'personal')).toBe(false);
    expect(isScopeAtLeast('none', 'personal')).toBe(false);
  });

  it('phạm vi cá nhân KHÔNG đạt mức khoa/toàn bộ (lễ tân với danh sách phiếu chốt ca)', () => {
    expect(isScopeAtLeast('personal', 'personal')).toBe(true);
    expect(isScopeAtLeast('personal', 'department')).toBe(false);
    expect(isScopeAtLeast('personal', 'global')).toBe(false);
  });

  it('phạm vi rộng hơn luôn đạt mức hẹp hơn', () => {
    expect(isScopeAtLeast('department', 'personal')).toBe(true);
    expect(isScopeAtLeast('department', 'department')).toBe(true);
    expect(isScopeAtLeast('department', 'global')).toBe(false);
    expect(isScopeAtLeast('global', 'department')).toBe(true);
    expect(isScopeAtLeast('global', 'global')).toBe(true);
  });
});
