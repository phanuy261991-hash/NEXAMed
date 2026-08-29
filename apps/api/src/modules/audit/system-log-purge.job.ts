import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { AuditLogRepository } from './audit-log.repository';
import { purgeSystemLogsForAllTenants } from './system-log-purge';

/**
 * Job nền đầu tiên của dự án dùng `@nestjs/schedule` (S5-05, chính sách lưu trữ 2 tầng) — chạy mỗi
 * ngày, xoá "System Log" quá hạn cho mọi tenant. KHÔNG ghi `audit_log` cho chính hành động xoá này
 * (tự tham chiếu vào bảng đang xoá không có ý nghĩa) — chỉ log ra console, cùng mẫu
 * `syncRolePermissionsForAllTenants()` ở `main.ts`.
 */
@Injectable()
export class SystemLogPurgeJob {
  private readonly logger = new Logger(SystemLogPurgeJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleCron(): Promise<void> {
    const deleted = await purgeSystemLogsForAllTenants(this.prisma, this.unitOfWork, this.auditLogRepository);
    if (deleted > 0) {
      this.logger.log(`Đã xoá ${deleted} dòng System Log quá hạn lưu trữ.`);
    }
  }
}
