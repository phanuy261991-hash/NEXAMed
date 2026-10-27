import { describe, expect, it } from 'vitest';
import { decryptPii, encryptPii, hashForLookup, tryDecryptPii } from './pii-encryption';

const KEY = 'test-encryption-key-at-least-32-characters-long';
const OTHER_KEY = 'khac-key-32-ky-tu-tro-len-000000000000';

describe('tryDecryptPii (đọc không ném lỗi, #262)', () => {
  it('đúng khoá → plaintext; sai khoá hoặc dữ liệu hỏng/rỗng → null (không ném)', () => {
    const encrypted = encryptPii('012345678901', KEY);
    expect(tryDecryptPii(encrypted, KEY)).toBe('012345678901');
    expect(tryDecryptPii(encrypted, OTHER_KEY)).toBeNull();
    expect(tryDecryptPii(Buffer.from('rac'), KEY)).toBeNull();
    expect(tryDecryptPii(Buffer.alloc(0), KEY)).toBeNull();
  });
});

describe('pii-encryption', () => {
  it('encrypt rồi decrypt trả lại đúng plaintext gốc', () => {
    const plaintext = '012345678901';
    const encrypted = encryptPii(plaintext, KEY);
    expect(decryptPii(encrypted, KEY)).toBe(plaintext);
  });

  it('mỗi lần mã hoá cho ciphertext khác nhau (iv ngẫu nhiên) dù cùng plaintext', () => {
    const a = encryptPii('012345678901', KEY);
    const b = encryptPii('012345678901', KEY);
    expect(a.equals(b)).toBe(false);
  });

  it('sai khoá thì decrypt ném lỗi (auth tag không khớp) thay vì trả dữ liệu sai', () => {
    const encrypted = encryptPii('012345678901', KEY);
    expect(() => decryptPii(encrypted, OTHER_KEY)).toThrow();
  });

  it('hashForLookup xác định: cùng input luôn ra cùng hash', () => {
    expect(hashForLookup('012345678901', KEY)).toBe(hashForLookup('012345678901', KEY));
  });

  it('hashForLookup khác input hoặc khác khoá thì ra hash khác', () => {
    expect(hashForLookup('012345678901', KEY)).not.toBe(hashForLookup('012345678902', KEY));
    expect(hashForLookup('012345678901', KEY)).not.toBe(hashForLookup('012345678901', OTHER_KEY));
  });
});
