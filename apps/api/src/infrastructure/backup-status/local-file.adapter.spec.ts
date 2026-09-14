import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { LocalFileBackupStatusAdapter } from './local-file.adapter';

function fakeConfigService(filePath: string | undefined): ConfigService<Env, true> {
  return { get: () => filePath } as unknown as ConfigService<Env, true>;
}

describe('LocalFileBackupStatusAdapter', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'nexamed-backup-status-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('BACKUP_STATUS_FILE không đặt — isEnabled false, read trả null (máy dev)', async () => {
    const adapter = new LocalFileBackupStatusAdapter(fakeConfigService(undefined));
    expect(adapter.isEnabled()).toBe(false);
    expect(await adapter.read()).toBeNull();
  });

  it('đã cấu hình nhưng file chưa tồn tại — isEnabled true, read trả null (chưa có lần chạy nào)', async () => {
    const filePath = join(baseDir, 'khong-ton-tai.json');
    const adapter = new LocalFileBackupStatusAdapter(fakeConfigService(filePath));
    expect(adapter.isEnabled()).toBe(true);
    expect(await adapter.read()).toBeNull();
  });

  it('đọc đúng nội dung file hợp lệ do backup.sh ghi ra', async () => {
    const filePath = join(baseDir, 'status.json');
    const snapshot = {
      lastRunAt: '2026-09-15T02:00:03+00:00',
      lastRunOk: true,
      lastSuccessAt: '2026-09-15T02:00:03+00:00',
      consecutiveFailures: 0,
      lastError: null,
    };
    await writeFile(filePath, JSON.stringify(snapshot));
    const adapter = new LocalFileBackupStatusAdapter(fakeConfigService(filePath));

    expect(await adapter.read()).toEqual(snapshot);
  });

  it('file hỏng (không phải JSON hợp lệ) — read trả null, không throw', async () => {
    const filePath = join(baseDir, 'corrupt.json');
    await writeFile(filePath, '{ dở dang không đóng ngoặc');
    const adapter = new LocalFileBackupStatusAdapter(fakeConfigService(filePath));

    await expect(adapter.read()).resolves.toBeNull();
  });

  it('file đúng JSON nhưng sai hình dạng — read trả null, không throw', async () => {
    const filePath = join(baseDir, 'wrong-shape.json');
    await writeFile(filePath, JSON.stringify({ foo: 'bar' }));
    const adapter = new LocalFileBackupStatusAdapter(fakeConfigService(filePath));

    await expect(adapter.read()).resolves.toBeNull();
  });
});
