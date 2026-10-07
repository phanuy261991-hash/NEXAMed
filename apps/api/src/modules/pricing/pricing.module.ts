import { Module } from '@nestjs/common';
import { ClinicModule } from '../clinic/clinic.module';
import { DrugModule } from '../drug/drug.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { TechnicalServiceModule } from '../technical-service/technical-service.module';
import { PriceableCatalogService } from './priceable-catalog.service';
import { PriceListController } from './price-list.controller';
import { PriceListExportService } from './price-list-export.service';
import { PriceListRepository } from './price-list.repository';
import { PriceListService } from './price-list.service';
import { PricingService } from './pricing.service';
import { ServicePackageController } from './service-package.controller';
import { ServicePackageRepository } from './service-package.repository';
import { ServicePackageService } from './service-package.service';

/**
 * Gói dịch vụ + Bảng giá có thời hạn (Cận lâm sàng GĐ2, docs/DECISIONS.md #212). Đọc dịch vụ khám / dịch vụ kỹ thuật / thuốc
 * qua repository mà module sở hữu export (một chiều `pricing → các module đó`); `ClinicModule` chỉ để cấp mã tự sinh.
 * `exports: [PricingService, ...]` cho `PricingPortModule` (bind `PRICING_PORT` cho kho thuốc) và GĐ3 (chỉ định).
 */
@Module({
  imports: [ClinicModule, DrugModule, ReferenceCatalogModule, TechnicalServiceModule],
  controllers: [ServicePackageController, PriceListController],
  providers: [ServicePackageService, ServicePackageRepository, PriceListService, PriceListRepository, PriceListExportService, PricingService, PriceableCatalogService],
  exports: [PricingService, ServicePackageRepository, PriceListRepository, PriceableCatalogService],
})
export class PricingModule {}
