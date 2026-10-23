import { Injectable, Logger } from '@nestjs/common';
import { Interval, Timeout } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { IdempotencyKeyRepository } from './idempotency-key.repository';

/**
 * Dọn khoá chống ghi trùng đã hết hạn (docs/DECISIONS.md #257) — cùng khuôn `ExpiredSessionPurgeJob` (#244): KHÔNG hẹn giờ ban đêm (máy phòng khám tắt buổi tối),
 * chạy một lần ít phút sau khi máy chủ khởi động rồi lặp mỗi `INTERVAL_HOURS` giờ. Idempotent (chỉ xoá dòng đã quá hạn); mỗi công ty một giao dịch riêng để RLS tự giới hạn.
 * KHÔNG ghi `audit_log` (dữ liệu kỹ thuật), chỉ log ra console.
 */
const STARTUP_DELAY_MS = 4 * 60_000;
const INTERVAL_HOURS = 6;

@Injectable()
export class IdempotencyPurgeJob {
  private readonly logger = new Logger(IdempotencyPurgeJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: IdempotencyKeyRepository,
  ) {}

  @Timeout(STARTUP_DELAY_MS)
  async handleAfterStartup(): Promise<void> {
    await this.purge();
  }

  @Interval(INTERVAL_HOURS * 60 * 60_000)
  async handleInterval(): Promise<void> {
    await this.purge();
  }

  /** Công khai để test gọi trực tiếp (test API tắt lập lịch nền). Trả số dòng đã xoá. */
  async purge(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const tenants = await this.prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
      let deleted = 0;
      for (const tenant of tenants) {
        deleted += await this.unitOfWork.runInTenantScope(tenant.id, (tx) => this.repository.purgeExpired(tx, tenant.id, now));
      }
      if (deleted > 0) this.logger.log(`Đã xoá ${deleted} khoá chống ghi trùng hết hạn.`);
      return deleted;
    } catch (error) {
      // Dọn dẹp lỗi không được làm sập máy chủ — lần chạy kế tiếp thử lại.
      this.logger.error(`Dọn khoá chống ghi trùng thất bại: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
