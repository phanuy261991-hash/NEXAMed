import { Module } from '@nestjs/common';
import { ClinicModule } from '../clinic/clinic.module';
import { LabIndicatorController } from './lab-indicator.controller';
import { LabIndicatorRepository } from './lab-indicator.repository';
import { LabIndicatorService } from './lab-indicator.service';
import { ResultTemplateController } from './result-template.controller';
import { ResultTemplateRepository } from './result-template.repository';
import { ResultTemplateService } from './result-template.service';
import { TechnicalServiceController } from './technical-service.controller';
import { TechnicalServiceRepository } from './technical-service.repository';
import { TechnicalServiceService } from './technical-service.service';

/**
 * Cận lâm sàng — Danh mục (GĐ1, docs/DECISIONS.md #212): dịch vụ kỹ thuật + đơn giá, chỉ số xét nghiệm + khoảng tham
 * chiếu, mẫu kết quả. `imports: [ClinicModule]` chỉ để cấp mã tự sinh qua `BusinessCodeService` (một chiều). Các giai
 * đoạn sau (Gói/Bảng giá/Chỉ định/Kết quả) mở rộng chính module này hoặc tách module riêng khi đủ lớn.
 * `exports: [TechnicalServiceRepository, LabIndicatorRepository]` — GĐ3/GĐ4 đọc dịch vụ/chỉ số trong cùng transaction.
 */
@Module({
  imports: [ClinicModule],
  controllers: [TechnicalServiceController, LabIndicatorController, ResultTemplateController],
  providers: [
    TechnicalServiceService,
    TechnicalServiceRepository,
    LabIndicatorService,
    LabIndicatorRepository,
    ResultTemplateService,
    ResultTemplateRepository,
  ],
  exports: [TechnicalServiceRepository, LabIndicatorRepository],
})
export class TechnicalServiceModule {}
