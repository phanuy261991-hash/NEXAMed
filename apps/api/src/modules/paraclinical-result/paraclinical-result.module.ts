import { Module } from '@nestjs/common';
import { ClinicModule } from '../clinic/clinic.module';
import { ClinicalOrderModule } from '../clinical-order/clinical-order.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { TechnicalServiceModule } from '../technical-service/technical-service.module';
import { ParaclinicalResultController } from './paraclinical-result.controller';
import { ParaclinicalResultRepository } from './paraclinical-result.repository';
import { ParaclinicalResultService } from './paraclinical-result.service';

/**
 * Cận lâm sàng GĐ4 — Hàng đợi & kết quả (docs/DECISIONS.md #212). Đọc/chuyển trạng thái dòng chỉ định qua `ClinicalOrderRepository`, đọc chỉ số + khoảng tham
 * chiếu qua `TechnicalServiceRepository`, tên danh mục qua `ReferenceCatalogRepository` (đều là repository module sở hữu export, một chiều); cấu hình phòng khám qua
 * `CLINIC_CONFIG_READER_PORT` (`ClinicModule`); tên người dùng/danh sách bác sĩ duyệt qua `UserAccountRepository` (`IamModule` @Global).
 */
@Module({
  imports: [ClinicModule, ClinicalOrderModule, ReferenceCatalogModule, TechnicalServiceModule],
  controllers: [ParaclinicalResultController],
  providers: [ParaclinicalResultService, ParaclinicalResultRepository],
  exports: [ParaclinicalResultRepository],
})
export class ParaclinicalResultModule {}
