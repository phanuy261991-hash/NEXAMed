import { Module } from '@nestjs/common';
import { ClinicModule } from '../clinic/clinic.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { LabIndicatorController } from './lab-indicator.controller';
import { LabIndicatorRepository } from './lab-indicator.repository';
import { LabIndicatorService } from './lab-indicator.service';
import { ResultTemplateController } from './result-template.controller';
import { ResultTemplateRepository } from './result-template.repository';
import { ResultTemplateService } from './result-template.service';
import { TechnicalServiceController } from './technical-service.controller';
import { TechnicalServiceImportController } from './technical-service-import.controller';
import { TechnicalServiceImportService } from './technical-service-import.service';
import { TechnicalServiceRepository } from './technical-service.repository';
import { TechnicalServiceService } from './technical-service.service';

/**
 * Cận lâm sàng — Danh mục (GĐ1, docs/DECISIONS.md #212): dịch vụ kỹ thuật + đơn giá, chỉ số xét nghiệm + khoảng tham
 * chiếu, mẫu kết quả. `imports: [ClinicModule]` chỉ để cấp mã tự sinh qua `BusinessCodeService` (một chiều). `ReferenceCatalogModule`: Nhập/Xuất Excel (#276) tra tên → mã danh mục và tạo mục mới theo tên. Các giai
 * đoạn sau (Gói/Bảng giá/Chỉ định/Kết quả) mở rộng chính module này hoặc tách module riêng khi đủ lớn.
 * `exports: [TechnicalServiceRepository, LabIndicatorRepository]` — GĐ3/GĐ4 đọc dịch vụ/chỉ số trong cùng transaction.
 */
@Module({
  imports: [ClinicModule, ReferenceCatalogModule],
  // `TechnicalServiceImportController` PHẢI đứng trước `TechnicalServiceController` (`GET technical-services/export|import-template` không bị `:id` nuốt).
  controllers: [TechnicalServiceImportController, TechnicalServiceController, LabIndicatorController, ResultTemplateController],
  providers: [
    TechnicalServiceService,
    TechnicalServiceImportService,
    TechnicalServiceRepository,
    LabIndicatorService,
    LabIndicatorRepository,
    ResultTemplateService,
    ResultTemplateRepository,
  ],
  exports: [TechnicalServiceRepository, LabIndicatorRepository],
})
export class TechnicalServiceModule {}
