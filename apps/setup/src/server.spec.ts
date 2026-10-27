import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSetupServer } from './server';
import type { SetupService } from './service';

let dir: string;
let server: Server;
let base: string;
const finish = vi.fn();

const service = {
  detect: async () => ({ mode: 'install' }),
  jobView: () => null,
  validate: () => ({ ok: false, errors: { profile: 'x' } }),
  startInstall: () => ({ ok: false, errors: { _: 'sai' } }),
  handoff: () => 'NOI DUNG',
  takeResult: () => ({ publicUrl: 'http://x', username: 'a', tempPassword: 'p', profile: 'lan', version: '0.9.0' }),
  keyInfo: vi.fn(async () => ({ fingerprint: 'BE19-5018', text: 'ENCRYPTION_KEY=abc' })),
  checkCertificate: vi.fn(() => ({ ok: true, errors: [], names: [] })),
} as unknown as SetupService;

async function start(key: string): Promise<void> {
  server = createSetupServer({ service, publicDir: dir, key, onFinish: finish });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nexamed-pub-'));
  await writeFile(join(dir, 'index.html'), '<h1>ok</h1>');
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

describe('máy chủ trình cài đặt', () => {
  it('không đặt mã: phục vụ giao diện và API', async () => {
    await start('');
    expect(await (await fetch(base + '/')).text()).toContain('<h1>ok</h1>');
    const state = await (await fetch(base + '/api/state')).json();
    expect(state.data.detect.mode).toBe('install');
  });

  it('đặt mã: không có mã/mã sai → 401; link đúng mã → cookie rồi vào được và mã không nằm trên thanh địa chỉ', async () => {
    await start('AAAA-BBBB-CCCC');
    expect((await fetch(base + '/api/state')).status).toBe(401);
    expect((await fetch(base + '/?key=sai')).status).toBe(401);
    const res = await fetch(base + '/?key=AAAA-BBBB-CCCC', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    const ok = await fetch(base + '/api/state', { headers: { cookie } });
    expect(ok.status).toBe(200);
  });

  it('từ chối tiêu đề Host lạ (chống DNS rebinding) nhưng nhận IP và localhost', async () => {
    await start('');
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      const req = request(base + '/api/state', { headers: { host: 'evil.example.com' } }, (res) => resolve(res.statusCode ?? 0));
      req.end();
    });
    expect(status).toBe(400);
    expect((await fetch(base + '/api/state')).status).toBe(200);
  });

  it('POST phải là JSON; thân quá lớn bị từ chối; đường dẫn lạ → 404; không cho thoát khỏi thư mục public', async () => {
    await start('');
    expect((await fetch(base + '/api/install', { method: 'POST', body: 'x' })).status).toBe(415);
    const big = JSON.stringify({ crt: 'x'.repeat(600 * 1024), key: 'k', baseDomain: 'a.vn' });
    expect((await fetch(base + '/api/cert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: big })).status).toBe(413);
    expect((await fetch(base + '/api/khong-co')).status).toBe(404);
    expect((await fetch(base + '/%2e%2e/%2e%2e/etc/passwd')).status).toBe(404);
  });

  it('thân RẤT lớn (3 MB) vẫn nhận được 413 (không treo, không bị đóng kết nối) và máy chủ còn phục vụ yêu cầu kế tiếp', async () => {
    await start('');
    const huge = JSON.stringify({ crt: 'x'.repeat(3 * 1024 * 1024), key: 'k', baseDomain: 'a.vn' });
    for (let i = 0; i < 3; i++) {
      const res = await fetch(base + '/api/cert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: huge });
      expect(res.status).toBe(413);
    }
    expect((await fetch(base + '/api/khong-co')).status).toBe(404);
  });

  it('cài với câu trả lời sai → 422 kèm lỗi theo ô; file bàn giao tải về dạng đính kèm', async () => {
    await start('');
    const res = await fetch(base + '/api/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(422);
    expect((await res.json()).error.details).toEqual({ _: 'sai' });
    const file = await fetch(base + '/api/handoff.txt');
    expect(file.headers.get('content-disposition')).toContain('attachment');
    expect(await file.text()).toContain('NOI DUNG');
  });

  it('file khoá hệ thống tải về dạng đính kèm; kết quả cài kèm MÃ KIỂM khoá (không phải khoá) (#262)', async () => {
    await start('');
    const file = await fetch(base + '/api/key.txt');
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('attachment');
    expect(file.headers.get('cache-control')).toBe('no-store');
    expect(await file.text()).toContain('ENCRYPTION_KEY=abc');
    const result = await (await fetch(base + '/api/result')).json();
    expect(result.data.keyFingerprint).toBe('BE19-5018');
    expect(JSON.stringify(result)).not.toContain('abc');
  });

  it('chưa cài xong (không có thông tin khoá) → /api/key.txt trả 404, không lộ gì', async () => {
    (service.keyInfo as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await start('');
    expect((await fetch(base + '/api/key.txt')).status).toBe(404);
  });

  it('đặt mã truy cập: /api/key.txt cũng cần đúng mã (không tải được khoá khi chưa xác thực)', async () => {
    await start('AAAA-BBBB-CCCC');
    expect((await fetch(base + '/api/key.txt')).status).toBe(401);
  });

  it('/api/finish gọi onFinish sau khi trả lời', async () => {
    await start('');
    const res = await fetch(base + '/api/finish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 600));
    expect(finish).toHaveBeenCalled();
  });
});
