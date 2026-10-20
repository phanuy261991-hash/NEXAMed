import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrescriptionSubmissionService } from './prescription-submission.service';

/**
 * Bộ gửi nền đơn thuốc liên thông (docs/DECISIONS.md #242 GĐ3, mockup 8c) — chạy mỗi phút, xử lý các đơn đến hạn của mọi công ty đã bật cả "Có liên thông" lẫn "Gửi đơn lên cổng".
 * Cùng khuôn `NoShowJob`. Không chạy chồng: lượt trước chưa xong (cổng chậm) thì bỏ qua lượt này. Việc gửi trùng đã được chặn thêm bằng "thuê" dòng (`locked_until`) ở DB.
 */
@Injectable()
export class PrescriptionSubmissionJob {
  private readonly logger = new Logger(PrescriptionSubmissionJob.name);
  private running = false;

  constructor(private readonly service: PrescriptionSubmissionService) {}

  @Cron('* * * * *')
  async handleCron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const processed = await this.service.runDueForAllTenants();
      if (processed > 0) this.logger.log(`Bộ gửi đơn thuốc liên thông đã xử lý ${processed} đơn.`);
    } catch (err) {
      this.logger.error(`Bộ gửi đơn thuốc liên thông lỗi: ${err instanceof Error ? err.name : 'không rõ'}`);
    } finally {
      this.running = false;
    }
  }
}
