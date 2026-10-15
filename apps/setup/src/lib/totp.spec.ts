import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, buildOtpAuthUri, generateTotpSecret, groupSecret, totpAt, verifyTotp } from './totp';

// Vector kiểm chuẩn RFC 6238 Appendix B (SHA-1, bí mật ASCII "12345678901234567890", 8 chữ số).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('khớp vector RFC 6238', () => {
    expect(totpAt(RFC_SECRET, 59_000, 8)).toBe('94287082');
    expect(totpAt(RFC_SECRET, 1_111_111_109_000, 8)).toBe('07081804');
    expect(totpAt(RFC_SECRET, 20_000_000_000_000, 8)).toBe('65353130');
  });
  it('base32 hai chiều', () => {
    const bytes = Buffer.from('nexamed-totp');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });
  it('verifyTotp nhận mã hiện tại và bước kề, từ chối mã sai/không phải 6 số', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = totpAt(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 120_000), now)).toBe(false);
    expect(verifyTotp(secret, '12345', now)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', now)).toBe(false);
  });
  it('otpauth và nhóm khoá', () => {
    expect(buildOtpAuthUri('ABC', 'vanhanh')).toContain('otpauth://totp/NEXAMed%3Avanhanh?secret=ABC');
    expect(groupSecret('ABCDEFGH')).toBe('ABCD EFGH');
  });
  it('giống hệt thuật toán của API (cùng bí mật, cùng thời điểm → cùng mã)', async () => {
    const api = await import('../../../api/src/infrastructure/crypto/totp');
    const secret = generateTotpSecret();
    expect(totpAt(secret, 1_800_000_000_000)).toBe(api.totpAt(secret, 1_800_000_000_000));
  });
});
