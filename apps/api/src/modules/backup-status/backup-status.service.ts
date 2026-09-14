import { Inject, Injectable } from '@nestjs/common';
import { BACKUP_STATUS_PORT, evaluateBackupStatus, type BackupStatusPort } from '@nexamed/core';
import type { BackupStatusResponse } from '@nexamed/shared';

/**
 * S6-01 (ADM-04) — đọc trạng thái sao lưu Postgres gần nhất qua `BackupStatusPort` (không phải
 * dữ liệu theo tenant — phản ánh CHÍNH instance Postgres đang chạy, dùng chung cho mọi tenant
 * trên cùng bản cài on-prem này, xem comment ở `BackupStatusPort`).
 */
@Injectable()
export class BackupStatusService {
  constructor(@Inject(BACKUP_STATUS_PORT) private readonly backupStatusPort: BackupStatusPort) {}

  async getStatus(): Promise<BackupStatusResponse> {
    const configured = this.backupStatusPort.isEnabled();
    if (!configured) {
      return {
        configured: false,
        lastRunAt: null,
        lastRunOk: null,
        lastSuccessAt: null,
        consecutiveFailures: 0,
        lastError: null,
        needsAttention: false,
        reason: null,
      };
    }
    const snapshot = await this.backupStatusPort.read();
    const alert = evaluateBackupStatus(snapshot, new Date());
    return {
      configured: true,
      lastRunAt: snapshot?.lastRunAt ?? null,
      lastRunOk: snapshot?.lastRunOk ?? null,
      lastSuccessAt: snapshot?.lastSuccessAt ?? null,
      consecutiveFailures: snapshot?.consecutiveFailures ?? 0,
      lastError: snapshot?.lastError ?? null,
      needsAttention: alert.needsAttention,
      reason: alert.reason,
    };
  }
}
