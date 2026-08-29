import { describe, expect, it } from 'vitest';
import { labelForEntityType } from './entity-type-labels';

describe('labelForEntityType', () => {
  it('trả về nhãn tiếng Việt cho entityType đã biết, không lộ UUID/tên kỹ thuật', () => {
    expect(labelForEntityType('invoice')).toBe('Phiếu thu');
    expect(labelForEntityType('user_account')).toBe('Tài khoản người dùng');
    expect(labelForEntityType('vital_sign')).toBe('Sinh hiệu');
  });

  it('fallback về nguyên văn cho entityType chưa có trong map', () => {
    expect(labelForEntityType('unknown_entity')).toBe('unknown_entity');
  });
});
