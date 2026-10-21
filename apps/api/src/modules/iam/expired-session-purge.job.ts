import { Injectable, Logger } from '@nestjs/common';
import { Interval, Timeout } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { SessionRepository } from './session.repository';
import { purgeExpiredSessionsForAllTenants } from './expired-session-purge';

/**
 * Dọn phiên đăng nhập đã hết hạn (docs/DECISIONS.md #244).
 *
 * **KHÔNG hẹn giờ ban đêm** (chủ dự án chỉ ra 21/10/2026): bản on-prem chạy trên máy tính của phòng khám, hết giờ làm là tắt máy — job hẹn 2 giờ sáng sẽ KHÔNG BAO GIỜ chạy.
 * Thay bằng: chạy một lần ít phút sau khi máy chủ khởi động (sáng bật máy là dọn), rồi lặp lại mỗi `INTERVAL_HOURS` giờ cho máy chạy liên tục (VPS/SaaS). Việc dọn là
 * idempotent (chỉ xoá dòng đã quá hạn) nên chạy thừa vô hại. Hoãn `STARTUP_DELAY_MS` để không tranh tài nguyên với lúc khởi động và với nhân viên đang đăng nhập đầu ca.
 * KHÔNG ghi `audit_log` cho chính việc dọn (dữ liệu kỹ thuật, dấu vết đăng nhập đã nằm ở `auth.login_success`), chỉ log ra console.
 */
const STARTUP_DELAY_MS = 3 * 60_000;
const INTERVAL_HOURS = 6;

@Injectable()
export class ExpiredSessionPurgeJob {
  private readonly logger = new Logger(ExpiredSessionPurgeJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly sessionRepository: SessionRepository,
  ) {}

  @Timeout(STARTUP_DELAY_MS)
  async handleAfterStartup(): Promise<void> {
    await this.purge();
  }

  @Interval(INTERVAL_HOURS * 60 * 60_000)
  async handleInterval(): Promise<void> {
    await this.purge();
  }

  /** `running` chặn chạy chồng khi lần trước còn dở (cơ sở dữ liệu lớn, lần dọn đầu tiên có thể lâu). */
  private async purge(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deleted = await purgeExpiredSessionsForAllTenants(this.prisma, this.unitOfWork, this.sessionRepository);
      if (deleted > 0) {
        this.logger.log(`Đã xoá ${deleted} phiên đăng nhập hết hạn quá thời gian lưu trữ.`);
      }
    } catch (error) {
      // Dọn dẹp lỗi không được làm sập máy chủ — lần chạy kế tiếp (sau INTERVAL_HOURS giờ) thử lại.
      this.logger.error(`Dọn phiên hết hạn thất bại: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
