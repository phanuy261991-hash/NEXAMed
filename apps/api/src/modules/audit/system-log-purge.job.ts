import { Injectable, Logger } from '@nestjs/common';
import { Interval, Timeout } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { AuditLogRepository } from './audit-log.repository';
import { purgeSystemLogsForAllTenants } from './system-log-purge';

/**
 * Job nền đầu tiên của dự án dùng `@nestjs/schedule` (S5-05, chính sách lưu trữ 2 tầng) — xoá "System Log" quá hạn cho mọi tenant.
 * KHÔNG ghi `audit_log` cho chính hành động xoá này (tự tham chiếu vào bảng đang xoá không có ý nghĩa) — chỉ log ra console, cùng mẫu
 * `syncRolePermissionsForAllTenants()` ở `main.ts`.
 *
 * **Bỏ hẹn giờ 2 giờ sáng (sửa 21/10/2026, docs/DECISIONS.md #244, chủ dự án chỉ ra)**: bản on-prem chạy trên máy tính phòng khám, hết giờ làm là tắt máy nên lịch ban đêm
 * KHÔNG BAO GIỜ chạy — bảng cứ thế phình. Nay chạy ít phút sau khi khởi động (sáng bật máy là dọn) rồi lặp mỗi `INTERVAL_HOURS` giờ; việc dọn idempotent nên chạy thừa vô hại.
 * Hoãn 5 phút (lệch với job dọn phiên ở 3 phút) để hai việc xoá hàng loạt không chạy cùng lúc lúc máy chủ vừa lên.
 */
const STARTUP_DELAY_MS = 5 * 60_000;
const INTERVAL_HOURS = 12;

@Injectable()
export class SystemLogPurgeJob {
  private readonly logger = new Logger(SystemLogPurgeJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  @Timeout(STARTUP_DELAY_MS)
  async handleAfterStartup(): Promise<void> {
    await this.purge();
  }

  @Interval(INTERVAL_HOURS * 60 * 60_000)
  async handleInterval(): Promise<void> {
    await this.purge();
  }

  private async purge(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deleted = await purgeSystemLogsForAllTenants(this.prisma, this.unitOfWork, this.auditLogRepository);
      if (deleted > 0) {
        this.logger.log(`Đã xoá ${deleted} dòng System Log quá hạn lưu trữ.`);
      }
    } catch (error) {
      this.logger.error(`Dọn System Log thất bại: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
