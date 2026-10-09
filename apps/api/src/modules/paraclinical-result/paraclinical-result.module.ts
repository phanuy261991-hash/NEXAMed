import { Module } from '@nestjs/common';
import { ClinicModule } from '../clinic/clinic.module';
import { ClinicalOrderModule } from '../clinical-order/clinical-order.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { TechnicalServiceModule } from '../technical-service/technical-service.module';
import { ImagingResultController } from './imaging-result.controller';
import { LabResultController } from './lab-result.controller';
import { ParaclinicalResultRepository } from './paraclinical-result.repository';
import { ParaclinicalResultService } from './paraclinical-result.service';
import { SpecimenTubeController } from './specimen-tube.controller';
import { SpecimenTubeRepository } from './specimen-tube.repository';
import { SpecimenTubeService } from './specimen-tube.service';

/**
 * Cận lâm sàng GĐ4 — Hàng đợi & kết quả (docs/DECISIONS.md #212) + Lấy mẫu xét nghiệm có ống mẫu/tem mã vạch (#220). Đọc/chuyển trạng thái dòng chỉ định qua `ClinicalOrderRepository`, đọc chỉ số + khoảng tham
 * chiếu qua `TechnicalServiceRepository`, tên danh mục qua `ReferenceCatalogRepository` (đều là repository module sở hữu export, một chiều); cấu hình phòng khám qua
 * `CLINIC_CONFIG_READER_PORT` và sinh mã ống (SID) qua `BusinessCodeService` (`ClinicModule`); tên người dùng/danh sách bác sĩ duyệt qua `UserAccountRepository` (`IamModule` @Global).
 */
@Module({
  imports: [ClinicModule, ClinicalOrderModule, ReferenceCatalogModule, TechnicalServiceModule],
  controllers: [LabResultController, ImagingResultController, SpecimenTubeController],
  providers: [ParaclinicalResultService, ParaclinicalResultRepository, SpecimenTubeService, SpecimenTubeRepository],
  exports: [ParaclinicalResultRepository],
})
export class ParaclinicalResultModule {}
