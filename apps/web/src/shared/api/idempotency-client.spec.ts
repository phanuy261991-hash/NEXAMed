import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApiClient, getApiClient, setAccessToken } from './client';

/**
 * Tích hợp `client.ts` ↔ `idempotency-key.ts` (docs/DECISIONS.md #257): khoá có thật sự đi theo request qua openapi-fetch, được giữ khi mất mạng/5xx, bỏ khi xong,
 * và lần thử lại sau khi làm mới phiên mang CÙNG khoá. Mô phỏng `fetch` toàn cục (openapi-fetch lấy `fetch` lúc tạo client nên phải stub TRƯỚC `configureApiClient`).
 */
type FetchCall = { url: string; method: string; headers: Headers; body: string };

describe('client — Idempotency-Key (#257)', () => {
  const calls: FetchCall[] = [];
  let responder: (call: FetchCall) => Response | Promise<Response>;

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    calls.length = 0;
    responder = () => json(200, { data: { ok: true }, meta: {} });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request) => {
        const call: FetchCall = { url: input.url, method: input.method, headers: input.headers, body: await input.clone().text() };
        calls.push(call);
        return responder(call);
      }),
    );
    configureApiClient({ apiBaseUrl: 'http://api.test', tenantId: '00000000-0000-4000-8000-000000000000' });
    setAccessToken('token-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(undefined);
  });

  // Đường dẫn thật nhưng kiểu lỏng: test này kiểm cơ chế gắn khoá, không kiểm hợp đồng của một endpoint cụ thể.
  const loose = () => getApiClient() as unknown as { POST: (path: string, init: { body: unknown }) => Promise<{ response: Response }>; GET: (path: string) => Promise<unknown> };
  const post = (body: Record<string, unknown>) => loose().POST('/api/v1/wallet/topup', { body });
  const keyOf = (call: FetchCall | undefined) => call?.headers.get('Idempotency-Key');

  it('POST JSON mang header Idempotency-Key là UUID; GET thì không', async () => {
    await post({ amount: 1 });
    await loose().GET('/api/v1/patients');
    expect(keyOf(calls[0])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(calls[1]?.method).toBe('GET');
    expect(keyOf(calls[1])).toBeNull();
  });

  it('MẤT MẠNG rồi bấm lại cùng nội dung → CÙNG khoá; thao tác thành công xong thì lần sau là khoá MỚI', async () => {
    responder = () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(post({ amount: 1 })).rejects.toThrow();
    responder = () => json(200, { data: { ok: true }, meta: {} });
    await post({ amount: 1 });
    expect(keyOf(calls[1])).toBe(keyOf(calls[0]));

    await post({ amount: 1 });
    expect(keyOf(calls[2])).not.toBe(keyOf(calls[1]));
  });

  it('lỗi máy chủ 503 rồi bấm lại → CÙNG khoá; bị từ chối rõ ràng (422) rồi bấm lại → khoá MỚI', async () => {
    responder = () => json(503, { error: { code: 'X', message: 'x' } });
    await post({ amount: 2 });
    await post({ amount: 2 });
    expect(keyOf(calls[1])).toBe(keyOf(calls[0]));

    responder = () => json(422, { error: { code: 'X', message: 'x' } });
    await post({ amount: 3 });
    await post({ amount: 3 });
    expect(keyOf(calls[3])).not.toBe(keyOf(calls[2]));
  });

  it('nội dung khác → khoá khác (không nhầm hai thao tác)', async () => {
    await post({ amount: 1 });
    await post({ amount: 2 });
    expect(keyOf(calls[0])).not.toBe(keyOf(calls[1]));
  });

  it('hết phiên 401 → làm mới token → thử lại: lần thử lại mang CÙNG khoá với lần đầu', async () => {
    responder = (call) => {
      if (call.url.endsWith('/api/v1/auth/refresh')) return json(200, { data: { accessToken: 'token-2' }, meta: {} });
      if (call.headers.get('Authorization') === 'Bearer token-1') return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
      return json(200, { data: { ok: true }, meta: {} });
    };
    const result = await post({ amount: 5 });
    expect(result.response.status).toBe(200);
    const topups = calls.filter((c) => c.url.endsWith('/wallet/topup'));
    expect(topups).toHaveLength(2);
    expect(keyOf(topups[1])).toBe(keyOf(topups[0]));
    expect(keyOf(calls.find((c) => c.url.endsWith('/auth/refresh')))).toBeNull();
  });
});
