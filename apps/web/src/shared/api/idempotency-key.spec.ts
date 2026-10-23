import { describe, expect, it } from 'vitest';
import { createIdempotencyKeyStore, shouldAttachIdempotencyKey, shouldKeepKeyAfterResponse } from './idempotency-key';

describe('shouldAttachIdempotencyKey', () => {
  it('chỉ POST JSON ngoài nhóm /auth/', () => {
    expect(shouldAttachIdempotencyKey('POST', 'http://x/api/v1/patients', 'application/json')).toBe(true);
    expect(shouldAttachIdempotencyKey('post', 'http://x/api/v1/patients', 'application/json; charset=utf-8')).toBe(true);
    expect(shouldAttachIdempotencyKey('GET', 'http://x/api/v1/patients', 'application/json')).toBe(false);
    expect(shouldAttachIdempotencyKey('PUT', 'http://x/api/v1/encounters/1/diagnoses', 'application/json')).toBe(false);
    expect(shouldAttachIdempotencyKey('PATCH', 'http://x/api/v1/patients/1', 'application/json')).toBe(false);
    expect(shouldAttachIdempotencyKey('POST', 'http://x/api/v1/auth/login', 'application/json')).toBe(false);
    expect(shouldAttachIdempotencyKey('POST', 'http://x/api/v1/auth/refresh', null)).toBe(false);
    expect(shouldAttachIdempotencyKey('POST', 'http://x/api/v1/patients/1/photo', 'multipart/form-data; boundary=x')).toBe(false);
    expect(shouldAttachIdempotencyKey('POST', 'http://x/api/v1/lab/orders/1/start', null)).toBe(false);
  });
});

describe('shouldKeepKeyAfterResponse', () => {
  it('giữ khi chưa biết thao tác đã xảy ra chưa (5xx, 409), bỏ khi đã có kết luận', () => {
    for (const status of [500, 502, 503, 504, 409]) expect(shouldKeepKeyAfterResponse(status), String(status)).toBe(true);
    for (const status of [200, 201, 204, 400, 401, 403, 404, 422, 423, 429]) expect(shouldKeepKeyAfterResponse(status), String(status)).toBe(false);
  });
});

describe('createIdempotencyKeyStore', () => {
  function build(start = 1_000) {
    let t = start;
    let n = 0;
    const store = createIdempotencyKeyStore({ now: () => t, generate: () => `key-${++n}`, retentionMs: 10 * 60_000 });
    return { store, advance: (ms: number) => (t += ms) };
  }

  it('cùng thao tác (bấm đúp / bấm lại) dùng lại cùng khoá; thao tác khác dùng khoá khác', () => {
    const { store } = build();
    expect(store.acquire('POST /a {"x":1}')).toBe('key-1');
    expect(store.acquire('POST /a {"x":1}')).toBe('key-1');
    expect(store.acquire('POST /a {"x":2}')).toBe('key-2');
  });

  it('thành công hoặc bị từ chối rõ ràng → bỏ khoá: lần gửi sau (cố ý, y hệt) là thao tác mới', () => {
    const { store } = build();
    expect(store.acquire('f')).toBe('key-1');
    store.settle('f', 200);
    expect(store.acquire('f')).toBe('key-2');
    store.settle('f', 422);
    expect(store.acquire('f')).toBe('key-3');
  });

  it('mất mạng (không có phản hồi), 5xx hoặc 409 → GIỮ khoá để bấm lại không ghi trùng', () => {
    const { store } = build();
    expect(store.acquire('f')).toBe('key-1');
    store.settle('f', null);
    expect(store.acquire('f')).toBe('key-1');
    store.settle('f', 503);
    expect(store.acquire('f')).toBe('key-1');
    store.settle('f', 409);
    expect(store.acquire('f')).toBe('key-1');
  });

  it('quá thời gian giữ thì khoá cũ bị bỏ', () => {
    const { store, advance } = build();
    expect(store.acquire('f')).toBe('key-1');
    advance(9 * 60_000);
    expect(store.acquire('f')).toBe('key-1');
    advance(11 * 60_000);
    expect(store.acquire('f')).toBe('key-2');
  });
});
