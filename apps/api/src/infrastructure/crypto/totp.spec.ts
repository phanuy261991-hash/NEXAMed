import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, buildOtpAuthUri, generateTotpSecret, totpAt, verifyTotp } from './totp';

// RFC 6238 Phụ lục B: bí mật ASCII "12345678901234567890" (SHA-1), mã 8 chữ số — 6 chữ số là 6 số cuối.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('đúng vector kiểm chuẩn của RFC', () => {
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ];
    for (const [seconds, expected] of vectors) {
      expect(totpAt(RFC_SECRET, seconds * 1000, 8), String(seconds)).toBe(expected);
      expect(totpAt(RFC_SECRET, seconds * 1000), String(seconds)).toBe(expected.slice(-6));
    }
  });

  it('base32 mã hoá/giải mã đối xứng', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7, 8]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(() => base32Decode('abc1')).toThrow();
  });

  it('bí mật sinh ra đủ dài và khác nhau mỗi lần', () => {
    const a = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(a);
  });

  it('chấp nhận lệch ±1 bước, từ chối xa hơn và mã sai/định dạng sai', () => {
    const now = 1_700_000_000_000;
    const code = totpAt(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now + 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now - 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now + 90_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, code === '000000' ? '000001' : '000000', now)).toBe(false);
    for (const bad of ['', '12345', '1234567', 'abcdef', ' 123456']) expect(verifyTotp(RFC_SECRET, bad, now), bad).toBe(false);
  });

  it('địa chỉ otpauth có bí mật và tên nhà phát hành', () => {
    const uri = buildOtpAuthUri('ABCDEFGH', 'tuan');
    expect(uri).toContain('otpauth://totp/NEXAMed%3Atuan');
    expect(uri).toContain('secret=ABCDEFGH');
    expect(uri).toContain('issuer=NEXAMed');
  });
});
