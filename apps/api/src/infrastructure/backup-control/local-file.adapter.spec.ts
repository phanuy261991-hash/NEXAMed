import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { LocalFileBackupControlAdapter } from './local-file.adapter';

function fakeConfigService(values: Partial<Record<'BACKUP_STATUS_FILE' | 'BACKUP_HOST_DIR_DISPLAY', string>>): ConfigService<Env, true> {
  return { get: (key: string) => values[key as keyof typeof values] } as unknown as ConfigService<Env, true>;
}

describe('LocalFileBackupControlAdapter', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexamed-backup-control-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('BACKUP_STATUS_FILE không đặt (máy dev/cloud) — không khả dụng, đọc ra null, ghi bị từ chối', async () => {
    const adapter = new LocalFileBackupControlAdapter(fakeConfigService({}));
    expect(adapter.isAvailable()).toBe(false);
    expect(await adapter.readConfig()).toBeNull();
    expect(await adapter.readRunRequestedAt()).toBeNull();
    expect(adapter.destinationDir()).toBeNull();
    await expect(adapter.writeConfig({ enabled: true, hourVn: 2, retentionDays: 14 })).rejects.toThrow();
    await expect(adapter.requestRun()).rejects.toThrow();
  });

  it('đã cấu hình: chưa có file cấu hình → null; ghi rồi đọc lại đúng; file ghi nguyên tử (không để lại file tạm)', async () => {
    const adapter = new LocalFileBackupControlAdapter(fakeConfigService({ BACKUP_STATUS_FILE: join(dir, 'backup-status.json'), BACKUP_HOST_DIR_DISPLAY: 'D:\\NEXAMed-backup' }));
    expect(adapter.isAvailable()).toBe(true);
    expect(await adapter.readConfig()).toBeNull();

    await adapter.writeConfig({ enabled: false, hourVn: 23, retentionDays: 30 });
    expect(await adapter.readConfig()).toEqual({ enabled: false, hourVn: 23, retentionDays: 30 });
    expect(JSON.parse(await readFile(join(dir, 'backup-config.json'), 'utf-8'))).toEqual({ enabled: false, hourVn: 23, retentionDays: 30 });
    await expect(readFile(join(dir, 'backup-config.json.tmp'), 'utf-8')).rejects.toThrow();
    expect(adapter.destinationDir()).toBe('D:\\NEXAMed-backup');
  });

  it('file cấu hình hỏng/sai định dạng → coi như chưa có (null), không làm sập request', async () => {
    const adapter = new LocalFileBackupControlAdapter(fakeConfigService({ BACKUP_STATUS_FILE: join(dir, 'backup-status.json') }));
    await writeFile(join(dir, 'backup-config.json'), '{ không phải json', 'utf-8');
    expect(await adapter.readConfig()).toBeNull();
    await writeFile(join(dir, 'backup-config.json'), JSON.stringify({ enabled: 'yes', hourVn: 99, retentionDays: 0 }), 'utf-8');
    expect(await adapter.readConfig()).toBeNull();
  });

  it('"Sao lưu ngay": gửi yêu cầu tạo cờ có mốc thời gian, đọc lại được; xoá cờ (container đã nhận) thì hết chờ', async () => {
    const adapter = new LocalFileBackupControlAdapter(fakeConfigService({ BACKUP_STATUS_FILE: join(dir, 'backup-status.json') }));
    expect(await adapter.readRunRequestedAt()).toBeNull();
    const requestedAt = await adapter.requestRun();
    expect(new Date(requestedAt).toString()).not.toBe('Invalid Date');
    expect(await adapter.readRunRequestedAt()).toBe(requestedAt);
    await rm(join(dir, 'backup-run-now'));
    expect(await adapter.readRunRequestedAt()).toBeNull();
  });
});
