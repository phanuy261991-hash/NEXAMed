import { describe, expect, it } from 'vitest';
import { generateSetupKey, generateTempPassword, randomHex } from './secrets';

describe('secrets', () => {
  it('randomHex đúng độ dài và không lặp', () => {
    expect(randomHex(24)).toMatch(/^[0-9a-f]{48}$/);
    expect(randomHex(32)).not.toBe(randomHex(32));
  });
  it('mật khẩu tạm dạng XXXX-XXXX-XXXX, không có ký tự dễ nhầm', () => {
    for (let i = 0; i < 50; i += 1) expect(generateTempPassword()).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
  });
  it('mã link dạng XXXX-XXXX-XXXX', () => {
    expect(generateSetupKey()).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  });
});
