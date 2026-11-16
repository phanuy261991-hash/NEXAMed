import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { LocalDiskStorageAdapter } from './local-disk.adapter';

function fakeConfigService(storageDir: string): ConfigService<Env, true> {
  return { get: () => storageDir } as unknown as ConfigService<Env, true>;
}

describe('LocalDiskStorageAdapter', () => {
  let baseDir: string;
  let adapter: LocalDiskStorageAdapter;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'nexamed-storage-'));
    adapter = new LocalDiskStorageAdapter(fakeConfigService(baseDir));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('save rồi read trả lại đúng nội dung, cách ly theo tenant', async () => {
    const content = new TextEncoder().encode('hello');
    const ref = await adapter.save('tenant-a', 'files/a.txt', content, 'text/plain');

    expect(ref).toEqual({ key: 'files/a.txt', sizeBytes: content.byteLength, contentType: 'text/plain' });
    expect(await adapter.read('tenant-a', 'files/a.txt')).toEqual(content);
  });

  it('sizeOf trả đúng dung lượng không đọc nội dung; tệp không còn thì trả null', async () => {
    await adapter.save('tenant-a', 'docs/b.bin', new Uint8Array(1234), 'application/octet-stream');
    expect(await adapter.sizeOf('tenant-a', 'docs/b.bin')).toBe(1234);
    expect(await adapter.sizeOf('tenant-a', 'docs/khong-co.bin')).toBeNull();
    expect(await adapter.sizeOf('tenant-b', 'docs/b.bin')).toBeNull(); // cách ly theo tenant
  });

  it('volumeUsage báo tổng và chỗ trống của ổ chứa kho (tổng > 0, trống ≤ tổng)', async () => {
    const usage = await adapter.volumeUsage();
    expect(usage).not.toBeNull();
    expect(usage!.totalBytes).toBeGreaterThan(0);
    expect(usage!.freeBytes).toBeGreaterThanOrEqual(0);
    expect(usage!.freeBytes).toBeLessThanOrEqual(usage!.totalBytes);
  });

  it('delete xoá file, read sau đó lỗi', async () => {
    const content = new TextEncoder().encode('x');
    await adapter.save('tenant-a', 'a.txt', content, 'text/plain');
    await adapter.delete('tenant-a', 'a.txt');

    await expect(adapter.read('tenant-a', 'a.txt')).rejects.toThrow();
  });

  it('delete file không tồn tại không lỗi (force)', async () => {
    await expect(adapter.delete('tenant-a', 'khong-ton-tai.txt')).resolves.toBeUndefined();
  });

  it('key chứa ".." bị chặn', async () => {
    const content = new TextEncoder().encode('x');
    await expect(adapter.save('tenant-a', '../escape.txt', content, 'text/plain')).rejects.toThrow();
  });
});
