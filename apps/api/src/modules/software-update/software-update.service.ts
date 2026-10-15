import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  DOCTOR_DIRECTORY_PORT,
  UPDATE_CHECK_PORT,
  deriveUpdateState,
  type DoctorDirectoryPort,
  type UpdateCheckOutcome,
  type UpdateCheckPort,
} from '@nexamed/core';
import { z } from 'zod';
import type { SoftwareUpdateStatus, UpdateChannel, UpdateCheckHistoryItem } from '@nexamed/shared';
import type { Env } from '../../config/env.schema';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { SystemVersionService } from '../system/system-version.service';

/** Số dòng lịch sử kiểm tra hiển thị ở trang "Cập nhật phần mềm". */
const HISTORY_LIMIT = 5;
/** Chờ máy chủ khởi động xong hẳn (migration, đồng bộ quyền…) rồi mới hỏi máy chủ phát hành lần đầu. */
const FIRST_CHECK_DELAY_MS = 30_000;
const historyPayloadSchema = z.object({
  result: z.enum(['up_to_date', 'update_available', 'error']),
  latestVersion: z.string().nullable(),
});

/**
 * Kiểm tra cập nhật phần mềm (docs/DECISIONS.md #236, bước 2). Đây là việc của CẢ MÁY CHỦ (một phiên bản chạy cho cả công ty), không theo chi nhánh.
 * - Kết quả lần kiểm tra gần nhất giữ trong bộ nhớ; tự làm mới định kỳ (không ghi nhật ký) CHỈ khi đã cấu hình máy chủ phát hành và hệ thống phục vụ một công ty.
 * - Người dùng bấm "Kiểm tra ngay" mới ghi nhật ký `software_update.checked` (ai kiểm lúc nào, kết quả gì) — nguồn của bảng "Lịch sử kiểm tra gần đây".
 * - Chỉ KIỂM TRA, không tải hay áp dụng gì (bước sau).
 */
@Injectable()
export class SoftwareUpdateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SoftwareUpdateService.name);
  private outcome: UpdateCheckOutcome['result'] = null;
  private lastCheckedAt: Date | null = null;

  constructor(
    @Inject(UPDATE_CHECK_PORT) private readonly updateCheck: UpdateCheckPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    private readonly config: ConfigService<Env, true>,
    private readonly versionService: SystemVersionService,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.shouldCheckInBackground()) return;
    // `unref`: chờ lần kiểm đầu không giữ tiến trình sống (tắt máy chủ/kết thúc test không bị trì hoãn).
    setTimeout(() => void this.runBackgroundCheck(), FIRST_CHECK_DELAY_MS).unref();
  }

  @Cron('0 */6 * * *')
  async handleCron(): Promise<void> {
    await this.runBackgroundCheck();
  }

  /** Kiểm định kỳ, KHÔNG ghi nhật ký (không có người thao tác). Công khai để test gọi thẳng. */
  async runBackgroundCheck(): Promise<void> {
    if (!this.shouldCheckInBackground()) return;
    await this.fetchAndStore();
  }

  /** Người dùng bấm "Kiểm tra ngay": hỏi máy chủ phát hành, ghi nhật ký, trả trạng thái mới. Chưa cấu hình máy chủ phát hành thì không có gì để hỏi — trả trạng thái hiện tại, không ghi nhật ký. */
  async check(tenantId: string, actorId: string, meta: RequestMeta): Promise<SoftwareUpdateStatus> {
    if (!this.updateCheck.isConfigured()) return this.getStatus(tenantId);
    await this.fetchAndStore();
    const status = await this.buildStatus(tenantId, false);
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      writeAuditLog(tx, tenantId, {
        actorId,
        action: 'software_update.checked',
        entityType: 'software_update',
        entityId: tenantId,
        afterJson: { result: status.state === 'update_available' ? 'update_available' : status.state === 'error' ? 'error' : 'up_to_date', latestVersion: status.latest?.version ?? null, channel: status.channel },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
    return this.getStatus(tenantId);
  }

  getStatus(tenantId: string): Promise<SoftwareUpdateStatus> {
    return this.buildStatus(tenantId, true);
  }

  private shouldCheckInBackground(): boolean {
    return this.updateCheck.isConfigured() && this.config.get('DEPLOYMENT_MODE', { infer: true }) === 'single';
  }

  private async fetchAndStore(): Promise<void> {
    const channel = await this.channel();
    // Cổng không bao giờ ném lỗi; bọc thêm để một sự cố ngoài dự kiến không làm sập tiến trình nền.
    try {
      this.outcome = await this.updateCheck.fetchLatest(channel);
    } catch {
      this.logger.warn('Kiểm tra bản mới gặp lỗi ngoài dự kiến.');
      this.outcome = { kind: 'error', message: 'Không kiểm tra được bản mới.' };
    }
    this.lastCheckedAt = new Date();
  }

  /** Máy phát triển (`dev`) hỏi như kênh Ổn định; khách không tự chọn kênh. */
  private async channel(): Promise<UpdateChannel> {
    const { channel } = await this.versionService.getVersion();
    return channel === 'beta' ? 'beta' : 'stable';
  }

  private async buildStatus(tenantId: string, includeHistory: boolean): Promise<SoftwareUpdateStatus> {
    const { version } = await this.versionService.getVersion();
    const derived = deriveUpdateState({ configured: this.updateCheck.isConfigured(), currentVersion: version, result: this.outcome });
    return {
      state: derived.state,
      configured: this.updateCheck.isConfigured(),
      releaseServerUrl: this.updateCheck.getServerUrl(),
      channel: await this.channel(),
      currentVersion: version,
      latest: derived.latest,
      needsIntermediateVersion: derived.needsIntermediateVersion,
      lastCheckedAt: this.lastCheckedAt?.toISOString() ?? null,
      errorMessage: derived.errorMessage,
      history: includeHistory ? await this.readHistory(tenantId) : [],
    };
  }

  private async readHistory(tenantId: string): Promise<UpdateCheckHistoryItem[]> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.auditLogRepository.list(tx, tenantId, { take: HISTORY_LIMIT, action: 'software_update.checked' }),
    );
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => id !== null))];
    const names = actorIds.length > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, actorIds) : new Map<string, string>();
    return rows.map((row) => {
      // `afterJson` do chính module này ghi; vẫn kiểm qua Zod vì dòng nhật ký là dữ liệu đọc từ DB, không tin cấu trúc.
      const after = historyPayloadSchema.safeParse(row.afterJson);
      return {
        at: row.occurredAt.toISOString(),
        byName: row.actorId ? (names.get(row.actorId) ?? null) : null,
        result: after.success ? after.data.result : 'error',
        latestVersion: after.success ? after.data.latestVersion : null,
      };
    });
  }
}
