import { describe, expect, it } from 'vitest';
import { maxDataScope } from './data-scope';

describe('maxDataScope', () => {
  it('mảng rỗng → none (không có quyền nào nghĩa là không có quyền)', () => {
    expect(maxDataScope([])).toBe('none');
  });

  it('lấy scope rộng nhất trong nhiều vai trò', () => {
    expect(maxDataScope(['personal'])).toBe('personal');
    expect(maxDataScope(['none', 'personal'])).toBe('personal');
    expect(maxDataScope(['personal', 'department'])).toBe('department');
    expect(maxDataScope(['department', 'global'])).toBe('global');
    expect(maxDataScope(['global', 'none', 'personal'])).toBe('global');
  });

  it('nhiều dòng cùng scope không đổi kết quả', () => {
    expect(maxDataScope(['none', 'none'])).toBe('none');
    expect(maxDataScope(['global', 'global'])).toBe('global');
  });
});
