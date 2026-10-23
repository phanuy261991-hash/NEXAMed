import { describe, expect, it } from 'vitest';
import { makeDraftId } from './make-draft-id';
import { generateUuid } from './uuid';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Mô phỏng ngữ cảnh KHÔNG bảo mật (HTTP thường trong LAN): có `getRandomValues` nhưng KHÔNG có `randomUUID`. */
function withInsecureContextCrypto<T>(run: () => T): T {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: original.getRandomValues.bind(original) }, configurable: true });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
  }
}

describe('generateUuid (docs/DECISIONS.md #257)', () => {
  it('sinh UUID v4 hợp lệ, không trùng', () => {
    const a = generateUuid();
    expect(a).toMatch(UUID);
    expect(generateUuid()).not.toBe(a);
  });

  it('vẫn sinh được khi trình duyệt KHÔNG có crypto.randomUUID (HTTP thường trong LAN phòng khám)', () => {
    withInsecureContextCrypto(() => {
      const a = generateUuid();
      expect(a).toMatch(UUID);
      expect(generateUuid()).not.toBe(a);
    });
  });

  it('1.000 giá trị liên tiếp ở ngữ cảnh không bảo mật không trùng nhau', () => {
    withInsecureContextCrypto(() => {
      expect(new Set(Array.from({ length: 1000 }, () => generateUuid())).size).toBe(1000);
    });
  });
});

describe('makeDraftId — key React của dòng nháp (Kê đơn, Phát thuốc, Đơn thuốc mẫu...)', () => {
  it('không ném lỗi và vẫn duy nhất ở ngữ cảnh không bảo mật', () => {
    withInsecureContextCrypto(() => {
      const a = makeDraftId();
      expect(a).toMatch(UUID);
      expect(makeDraftId()).not.toBe(a);
    });
  });
});
