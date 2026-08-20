import { describe, expect, it } from 'vitest';
import { generateReferenceCatalogCode } from './generate-code';

describe('generateReferenceCatalogCode', () => {
  it('tiền tố đúng 2 ký tự đầu category (viết hoa), có dấu gạch nối, tổng độ dài cố định', () => {
    const code = generateReferenceCatalogCode('academic_title');
    expect(code).toMatch(/^AC-[A-F0-9]{8}$/);
  });

  it('2 lần gọi liên tiếp cho cùng category không trùng nhau', () => {
    const a = generateReferenceCatalogCode('EMPLOYMENT_STATUS');
    const b = generateReferenceCatalogCode('EMPLOYMENT_STATUS');
    expect(a).not.toBe(b);
  });
});