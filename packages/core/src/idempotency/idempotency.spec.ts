import { describe, expect, it } from 'vitest';
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_MAX_RESPONSE_BYTES, IDEMPOTENCY_STALE_LOCK_MS, IDEMPOTENCY_TTL_MS, IDEMPOTENCY_WAIT_MS, isValidIdempotencyKey, stableStringify } from './idempotency';

describe('isValidIdempotencyKey', () => {
  it('nhận UUID (mọi phiên bản, hoa/thường)', () => {
    expect(isValidIdempotencyKey('0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).toBe(true);
    expect(isValidIdempotencyKey('0198A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B')).toBe(true);
  });

  it('từ chối chuỗi không phải UUID, rỗng, thừa/thiếu ký tự, có khoảng trắng hoặc ký tự lạ', () => {
    for (const bad of ['', 'abc', '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5', '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5bc', ' 0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5'", '0198a1b2c3d47e5f8a9b0c1d2e3f4a5b']) {
      expect(isValidIdempotencyKey(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('stableStringify', () => {
  it('không phụ thuộc thứ tự khoá, kể cả đối tượng lồng nhau và mảng chứa đối tượng', () => {
    const a = { name: 'A', amount: 5, nested: { y: 1, x: [{ b: 2, a: 1 }] } };
    const b = { nested: { x: [{ a: 1, b: 2 }], y: 1 }, amount: 5, name: 'A' };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('khác nội dung thì khác chuỗi; thứ tự phần tử mảng CÓ ý nghĩa', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('bỏ khoá undefined như JSON chuẩn; null giữ nguyên; undefined cấp cao nhất thành "null"', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    expect(stableStringify({ a: null })).toBe('{"a":null}');
    expect(stableStringify(undefined)).toBe('null');
  });

  it('giá trị không tuần tự hoá được thì ném lỗi (nơi gọi quyết định cách xử lý)', () => {
    expect(() => stableStringify({ a: 1n })).toThrow();
  });
});

describe('chính sách', () => {
  it('khoá hết hạn sau 24 giờ; tiếp quản lần treo sau 2 phút; chờ tối đa 20 giây; phản hồi lưu tối đa 512 KB; header chữ thường', () => {
    expect(IDEMPOTENCY_TTL_MS).toBe(86_400_000);
    expect(IDEMPOTENCY_STALE_LOCK_MS).toBe(120_000);
    expect(IDEMPOTENCY_WAIT_MS).toBe(20_000);
    expect(IDEMPOTENCY_MAX_RESPONSE_BYTES).toBe(524_288);
    expect(IDEMPOTENCY_KEY_HEADER).toBe('idempotency-key');
  });

  it('thời gian chờ lần gửi đầu ngắn hơn hạn coi là treo (không chờ vô ích một lần đã chết)', () => {
    expect(IDEMPOTENCY_WAIT_MS).toBeLessThan(IDEMPOTENCY_STALE_LOCK_MS);
  });
});
