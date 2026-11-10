import { Module } from '@nestjs/common';
import { ClinicModule } from '../clinic/clinic.module';
import { ClinicalOrderModule } from '../clinical-order/clinical-order.module';
import { ParaclinicalResultModule } from '../paraclinical-result/paraclinical-result.module';
import { SupplierDebtModule } from '../supplier-debt/supplier-debt.module';
import { LabPartnerDispatchController } from './lab-partner-dispatch.controller';
import { LabPartnerStatementController } from './lab-partner-statement.controller';
import { LabPartnerStatementService } from './lab-partner-statement.service';
import { LabPartnerDispatchRepository } from './lab-partner-dispatch.repository';
import { LabPartnerDispatchService } from './lab-partner-dispatch.service';
import { LabPartnerResultService } from './lab-partner-result.service';

/**
 * "Gửi mẫu đối tác" (docs/DECISIONS.md #291) — hàng đợi gửi mẫu xét nghiệm cho đối tác, đợt gửi, giá trả chụp lại, (giai đoạn sau) nhận kết quả PDF, ghi nợ, bảng kê.
 * `imports: [ClinicModule]`: sinh mã đợt gửi (`BusinessCodeService`) và đọc công tắc cấu hình (`CLINIC_CONFIG_READER_PORT`) — một chiều. Dòng chỉ định/ống mẫu/giá trả của module khác chỉ ĐỌC qua Prisma.
 */
@Module({
  imports: [ClinicModule, ClinicalOrderModule, ParaclinicalResultModule, SupplierDebtModule],
  controllers: [LabPartnerDispatchController, LabPartnerStatementController],
  providers: [LabPartnerDispatchService, LabPartnerResultService, LabPartnerStatementService, LabPartnerDispatchRepository],
})
export class LabPartnerModule {}
