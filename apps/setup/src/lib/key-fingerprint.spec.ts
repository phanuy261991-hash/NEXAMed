import { describe, expect, it } from 'vitest';
import { keyFingerprint } from './key-fingerprint';

describe('keyFingerprint (mã kiểm khoá, #262)', () => {
  it('vector cố định — PHẢI trùng bản ở apps/api (`key-fingerprint.spec.ts`), nếu không mã kiểm ghi lúc cài sẽ không khớp mã máy chủ tính', () => {
    expect(keyFingerprint('0123456789abcdef0123456789abcdef')).toBe('BE19-5018');
  });

  it('dạng XXXX-XXXX hex viết hoa, ổn định, khác khoá thì khác mã', () => {
    const a = keyFingerprint('khoa-so-1-khoa-so-1-khoa-so-1-khoa-so-1');
    expect(a).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(keyFingerprint('khoa-so-1-khoa-so-1-khoa-so-1-khoa-so-1')).toBe(a);
    expect(keyFingerprint('khoa-so-2-khoa-so-2-khoa-so-2-khoa-so-2')).not.toBe(a);
  });
});
