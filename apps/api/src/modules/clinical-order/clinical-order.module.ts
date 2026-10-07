import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ClinicModule } from '../clinic/clinic.module';
import { EncounterModule } from '../encounter/encounter.module';
import { PricingModule } from '../pricing/pricing.module';
import { TechnicalServiceModule } from '../technical-service/technical-service.module';
import { ClinicalOrderController } from './clinical-order.controller';
import { ClinicalOrderRepository } from './clinical-order.repository';
import { ClinicalOrderService } from './clinical-order.service';

/**
 * Cận lâm sàng GĐ3 — Chỉ định của bác sĩ (docs/DECISIONS.md #212). Đọc lượt khám (`EncounterRepository`), ghi tiền vào hoá đơn (`InvoiceRepository`), tra
 * giá (`PricingModule`), đọc dịch vụ kỹ thuật (`TechnicalServiceRepository`) và cấp mã CLS (`ClinicModule`) qua repository/service mà module sở hữu export
 * (một chiều). `exports: [ClinicalOrderRepository]` — GĐ4 (hàng đợi, kết quả) đọc dòng chỉ định trong cùng transaction.
 */
@Module({
  imports: [BillingModule, ClinicModule, EncounterModule, PricingModule, TechnicalServiceModule],
  controllers: [ClinicalOrderController],
  providers: [ClinicalOrderService, ClinicalOrderRepository],
  exports: [ClinicalOrderRepository],
})
export class ClinicalOrderModule {}
