import { Module } from '@nestjs/common';
import { ClinicModule } from '../clinic/clinic.module';
import { LabPartnerDispatchController } from './lab-partner-dispatch.controller';
import { LabPartnerDispatchRepository } from './lab-partner-dispatch.repository';
import { LabPartnerDispatchService } from './lab-partner-dispatch.service';

/**
 * "Gửi mẫu đối tác" (docs/DECISIONS.md #291) — hàng đợi gửi mẫu xét nghiệm cho đối tác, đợt gửi, giá trả chụp lại, (giai đoạn sau) nhận kết quả PDF, ghi nợ, bảng kê.
 * `imports: [ClinicModule]`: sinh mã đợt gửi (`BusinessCodeService`) và đọc công tắc cấu hình (`CLINIC_CONFIG_READER_PORT`) — một chiều. Dòng chỉ định/ống mẫu/giá trả của module khác chỉ ĐỌC qua Prisma.
 */
@Module({
  imports: [ClinicModule],
  controllers: [LabPartnerDispatchController],
  providers: [LabPartnerDispatchService, LabPartnerDispatchRepository],
})
export class LabPartnerModule {}
