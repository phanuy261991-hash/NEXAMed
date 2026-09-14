import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { BackupStatusPort, BackupStatusSnapshot } from '@nexamed/core';
import type { Env } from '../../config/env.schema';

/** Hình dạng file JSON `backup.sh` ghi ra — validate phòng vệ (file do script bash tạo, không tin
 *  tưởng tuyệt đối) trước khi trả ra ngoài. Xem `deploy/on-prem/backup/backup.sh`. */
const backupStatusFileSchema = z.object({
  lastRunAt: z.string().nullable(),
  lastRunOk: z.boolean().nullable(),
  lastSuccessAt: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});

/**
 * Adapter v1 cho `BackupStatusPort` — đọc file JSON trạng thái do container `backup` ghi ra 1
 * volume dùng chung (mount qua `BACKUP_STATUS_FILE`, xem `deploy/on-prem/docker-compose.yml`).
 * Không throw khi thiếu cấu hình/file — coi là "chưa có dữ liệu", đúng bản chất rủi ro cần cảnh
 * báo cho trường hợp file thật sự đã cấu hình nhưng thiếu (xem `evaluateBackupStatus`, S6-01).
 */
@Injectable()
export class LocalFileBackupStatusAdapter implements BackupStatusPort {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  isEnabled(): boolean {
    return Boolean(this.configService.get('BACKUP_STATUS_FILE', { infer: true }));
  }

  async read(): Promise<BackupStatusSnapshot | null> {
    const filePath = this.configService.get('BACKUP_STATUS_FILE', { infer: true });
    if (!filePath) {
      return null;
    }
    try {
      const raw = await readFile(filePath, 'utf-8');
      return backupStatusFileSchema.parse(JSON.parse(raw));
    } catch {
      // File chưa tồn tại (mới cài đặt, chưa tới lần sao lưu đầu tiên), hỏng, hoặc sai định dạng —
      // đều coi như "chưa có lần sao lưu thành công nào" thay vì làm sập request của actor.
      return null;
    }
  }
}
