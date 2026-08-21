import { describe, expect, it } from 'vitest';
import { generateAllergenCode, generateAllergenGroupCode } from './generate-code';

describe('generateAllergenGroupCode', () => {
  it('tiền tố "NDN-", 8 ký tự hex viết hoa', () => {
    expect(generateAllergenGroupCode()).toMatch(/^NDN-[A-F0-9]{8}$/);
  });

  it('2 lần gọi liên tiếp không trùng nhau', () => {
    expect(generateAllergenGroupCode()).not.toBe(generateAllergenGroupCode());
  });
});

describe('generateAllergenCode', () => {
  it('tiền tố "DN-", 8 ký tự hex viết hoa', () => {
    expect(generateAllergenCode()).toMatch(/^DN-[A-F0-9]{8}$/);
  });

  it('2 lần gọi liên tiếp không trùng nhau', () => {
    expect(generateAllergenCode()).not.toBe(generateAllergenCode());
  });
});
