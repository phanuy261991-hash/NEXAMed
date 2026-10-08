import { Inject, Injectable } from '@nestjs/common';
import { BACKUP_CONTROL_PORT, BACKUP_STATUS_PORT, BackupNotAvailableError, evaluateBackupStatus, type BackupControlPort, type BackupStatusPort } from '@nexamed/core';
import type { BackupConfig, BackupConfigResponse, BackupRunRequestResponse, BackupStatusResponse } from '@nexamed/shared';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import type { RequestMeta } from '../../common/request-meta';

/** Mặc định hiển thị khi container chưa kịp ghi file cấu hình (mới cài) — khớp mặc định `BACKUP_HOUR=2` UTC (= 9h VN) và 14 ngày của `docker-compose.yml`. */
const FALLBACK_CONFIG: BackupConfig = { enabled: true, hourVn: 9, retentionDays: 14 };
const NO_STATUS: BackupStatusResponse = { configured: false, lastRunAt: null, lastRunOk: null, lastSuccessAt: null, consecutiveFailures: 0, lastError: null, needsAttention: false, reason: null };

/**
 * Cấu hình sao lưu dữ liệu từ giao diện (docs/DECISIONS.md #217). Là cấu hình của CẢ MÁY CHỦ on-premise (không theo tenant) nên không có `tenant_id` ở dữ liệu;
 * chỉ ghi dấu vết (audit) vào tenant của người thao tác. Máy không có container sao lưu (dev/cloud) → `available:false`, các thao tác ghi bị từ chối.
 */
@Injectable()
export class BackupConfigService {
  constructor(
    @Inject(BACKUP_CONTROL_PORT) private readonly backupControl: BackupControlPort,
    @Inject(BACKUP_STATUS_PORT) private readonly backupStatus: BackupStatusPort,
    private readonly unitOfWork: UnitOfWorkService,
  ) {}

  async get(): Promise<BackupConfigResponse> {
    if (!this.backupControl.isAvailable()) {
      return { available: false, config: FALLBACK_CONFIG, destinationDir: null, runRequestedAt: null, status: NO_STATUS };
    }
    const snapshot = await this.backupStatus.read();
    const alert = evaluateBackupStatus(snapshot, new Date());
    return {
      available: true,
      config: (await this.backupControl.readConfig()) ?? FALLBACK_CONFIG,
      destinationDir: this.backupControl.destinationDir(),
      runRequestedAt: await this.backupControl.readRunRequestedAt(),
      status: {
        configured: true,
        lastRunAt: snapshot?.lastRunAt ?? null,
        lastRunOk: snapshot?.lastRunOk ?? null,
        lastSuccessAt: snapshot?.lastSuccessAt ?? null,
        consecutiveFailures: snapshot?.consecutiveFailures ?? 0,
        lastError: snapshot?.lastError ?? null,
        needsAttention: alert.needsAttention,
        reason: alert.reason,
      },
    };
  }

  async update(tenantId: string, actorId: string, dto: BackupConfig, meta: RequestMeta): Promise<BackupConfigResponse> {
    this.assertAvailable();
    const before = (await this.backupControl.readConfig()) ?? FALLBACK_CONFIG;
    await this.backupControl.writeConfig(dto);
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      writeAuditLog(tx, tenantId, {
        actorId,
        action: 'system_backup.config_updated',
        entityType: 'system_backup',
        entityId: tenantId,
        beforeJson: { enabled: before.enabled, hourVn: before.hourVn, retentionDays: before.retentionDays },
        afterJson: { enabled: dto.enabled, hourVn: dto.hourVn, retentionDays: dto.retentionDays },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
    return this.get();
  }

  async runNow(tenantId: string, actorId: string, meta: RequestMeta): Promise<BackupRunRequestResponse> {
    this.assertAvailable();
    const requestedAt = await this.backupControl.requestRun();
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      writeAuditLog(tx, tenantId, { actorId, action: 'system_backup.run_requested', entityType: 'system_backup', entityId: tenantId, afterJson: { requestedAt }, ip: meta.ip, userAgent: meta.userAgent }),
    );
    return { requestedAt };
  }

  private assertAvailable(): void {
    if (!this.backupControl.isAvailable()) throw new BackupNotAvailableError();
  }
}
