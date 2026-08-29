import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CLINIC_CONFIG_READER_PORT, type ClinicConfigReaderPort } from '@nexamed/core';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { AppointmentRepository } from './appointment.repository';
import { markNoShowForAllTenants } from './no-show';

/**
 * Job nền tự động đánh dấu "Không đến" (S5-07, APP-05) — chạy mỗi 5 phút (đã chốt với chủ dự án,
 * đủ nhanh để trạng thái phản ánh gần-thời-gian-thực trên lưới lịch hẹn, tải không đáng kể ở quy
 * mô phòng khám nhỏ). Chỉ tác động tenant đã BẬT `noShowAutoEnabled` (cấu hình pill "Lịch hẹn").
 * Cùng khuôn `SystemLogPurgeJob` (`apps/api/src/modules/audit/system-log-purge.job.ts`).
 */
@Injectable()
export class NoShowJob {
  private readonly logger = new Logger(NoShowJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly appointmentRepository: AppointmentRepository,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    const marked = await markNoShowForAllTenants(this.prisma, this.unitOfWork, this.appointmentRepository, this.clinicConfigReader);
    if (marked > 0) {
      this.logger.log(`Đã tự động đánh dấu ${marked} lịch hẹn "Không đến".`);
    }
  }
}
