import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { BackupControlConfig, BackupControlPort } from '@nexamed/core';
import type { Env } from '../../config/env.schema';

const configFileSchema = z.object({
  enabled: z.boolean(),
  hourVn: z.number().int().min(0).max(23),
  retentionDays: z.number().int().min(1).max(365),
});

/**
 * Adapter v1 cho `BackupControlPort` (docs/DECISIONS.md #217) — giao tiếp với container `backup` qua 2 file trong CÙNG volume với file trạng thái (`BACKUP_STATUS_FILE`):
 * `backup-config.json` (cấu hình, API ghi / script đọc mỗi vòng lặp) và `backup-run-now` (cờ "Sao lưu ngay", API tạo / script xoá khi nhận). Ghi cấu hình nguyên tử
 * (file tạm rồi đổi tên) để script không đọc trúng lúc ghi dở.
 */
@Injectable()
export class LocalFileBackupControlAdapter implements BackupControlPort {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  private dir(): string | null {
    const statusFile = this.configService.get('BACKUP_STATUS_FILE', { infer: true });
    return statusFile ? dirname(statusFile) : null;
  }

  isAvailable(): boolean {
    return this.dir() !== null;
  }

  async readConfig(): Promise<BackupControlConfig | null> {
    const dir = this.dir();
    if (!dir) return null;
    try {
      return configFileSchema.parse(JSON.parse(await readFile(join(dir, 'backup-config.json'), 'utf-8')));
    } catch {
      return null;
    }
  }

  async writeConfig(config: BackupControlConfig): Promise<void> {
    const dir = this.dir();
    if (!dir) throw new Error('Sao lưu chưa được cấu hình trên máy này.');
    const target = join(dir, 'backup-config.json');
    await writeFile(`${target}.tmp`, `${JSON.stringify(config)}\n`, 'utf-8');
    await rename(`${target}.tmp`, target);
  }

  async requestRun(): Promise<string> {
    const dir = this.dir();
    if (!dir) throw new Error('Sao lưu chưa được cấu hình trên máy này.');
    const requestedAt = new Date().toISOString();
    await writeFile(join(dir, 'backup-run-now'), requestedAt, 'utf-8');
    return requestedAt;
  }

  async readRunRequestedAt(): Promise<string | null> {
    const dir = this.dir();
    if (!dir) return null;
    try {
      const path = join(dir, 'backup-run-now');
      await stat(path);
      return (await readFile(path, 'utf-8')).trim() || null;
    } catch {
      return null;
    }
  }

  destinationDir(): string | null {
    return this.configService.get('BACKUP_HOST_DIR_DISPLAY', { infer: true }) ?? null;
  }
}
