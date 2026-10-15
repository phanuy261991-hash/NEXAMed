import { describe, expect, it } from 'vitest';
import { TENANT_CODE_PATTERN, formatDateVn, loginHostOf, previewLoginHost } from './platform-format';

describe('platform-format', () => {
  it('bỏ giao thức khỏi địa chỉ đăng nhập', () => {
    expect(loginHostOf('https://saomai.tenmien.vn')).toBe('saomai.tenmien.vn');
    expect(loginHostOf('http://saomai.localhost')).toBe('saomai.localhost');
    expect(loginHostOf(null)).toBeNull();
  });

  it('xem trước địa chỉ đăng nhập từ tên miền quản trị', () => {
    expect(previewLoginHost('matsang', 'admin.tenmien.vn')).toBe('matsang.tenmien.vn');
    expect(previewLoginHost('matsang', 'admin.localhost:5173')).toBe('matsang.localhost:5173');
    expect(previewLoginHost('', 'admin.tenmien.vn')).toBe('ma-cong-ty.tenmien.vn');
  });

  it('mã công ty: cùng quy tắc với máy chủ', () => {
    for (const ok of ['saomai', 'an-tam', 'abc', 'a'.repeat(30)]) expect(TENANT_CODE_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['', 'ab', 'a'.repeat(31), '-abc', 'abc-', 'Abc', 'a_b']) expect(TENANT_CODE_PATTERN.test(bad), bad).toBe(false);
  });

  it('ngày theo giờ Việt Nam (UTC+7)', () => {
    expect(formatDateVn('2026-10-15T20:00:00.000Z')).toBe('16/10/2026');
    expect(formatDateVn('2026-10-15T01:00:00.000Z')).toBe('15/10/2026');
  });
});
