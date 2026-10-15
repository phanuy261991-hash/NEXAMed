import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBootstrap } from './config';

const TENANT_ID = '01a13e1e-2d6e-7176-8330-7580f2eaabbb';

function stubFetch(handlers: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    const handler = handlers[url];
    if (!handler) throw new Error(`Không có handler cho ${url}`);
    return handler();
  });
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('resolveBootstrap', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'https://saomai.tenmien.vn' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('chế độ một công ty: có tenantId trong config.json → dùng ngay, KHÔNG gọi máy chủ để hỏi công ty', async () => {
    const calls = stubFetch({ '/config.json': () => json({ apiBaseUrl: 'http://localhost:3000', tenantId: TENANT_ID }) });
    expect(await resolveBootstrap()).toEqual({ kind: 'clinic', config: { apiBaseUrl: 'http://localhost:3000', tenantId: TENANT_ID } });
    expect(calls).toEqual(['/config.json']);
  });

  it('SaaS: không có tenantId → hỏi tên miền, apiBaseUrl rỗng = cùng nguồn gốc', async () => {
    stubFetch({
      '/config.json': () => json({ apiBaseUrl: '' }),
      'https://saomai.tenmien.vn/api/v1/public/tenant-context': () => json({ data: { kind: 'tenant', tenantId: TENANT_ID, name: 'Sao Mai', code: 'saomai', suspended: true } }),
    });
    expect(await resolveBootstrap()).toEqual({
      kind: 'clinic',
      config: { apiBaseUrl: 'https://saomai.tenmien.vn', tenantId: TENANT_ID, company: { name: 'Sao Mai', code: 'saomai', suspended: true } },
    });
  });

  it('SaaS: tên miền quản trị → khu quản trị; tên lạ (404) → không tìm thấy công ty', async () => {
    stubFetch({ '/config.json': () => json({}), 'https://saomai.tenmien.vn/api/v1/public/tenant-context': () => json({ data: { kind: 'platform' } }) });
    expect(await resolveBootstrap()).toEqual({ kind: 'platform', apiBaseUrl: 'https://saomai.tenmien.vn' });
    stubFetch({ '/config.json': () => json({}), 'https://saomai.tenmien.vn/api/v1/public/tenant-context': () => json({ error: { code: 'TENANT_NOT_FOUND' } }, 404) });
    expect(await resolveBootstrap()).toEqual({ kind: 'company_not_found' });
  });

  it('SaaS: máy chủ lỗi hoặc trả dữ liệu sai hình dạng → báo lỗi rõ, không đoán công ty', async () => {
    stubFetch({ '/config.json': () => json({}), 'https://saomai.tenmien.vn/api/v1/public/tenant-context': () => json({}, 500) });
    await expect(resolveBootstrap()).rejects.toThrow(/HTTP 500/);
    stubFetch({ '/config.json': () => json({}), 'https://saomai.tenmien.vn/api/v1/public/tenant-context': () => json({ data: { kind: 'tenant', name: 'thiếu id' } }) });
    await expect(resolveBootstrap()).rejects.toThrow(/không hợp lệ/);
  });
});
