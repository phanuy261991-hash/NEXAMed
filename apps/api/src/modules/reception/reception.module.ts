import { Module } from '@nestjs/common';
import { ReceptionController } from './reception.controller';
import { ReceptionService } from './reception.service';
import { VitalSignRepository } from './vital-sign.repository';
import { EncounterServiceItemRepository } from './encounter-service-item.repository';
import { AppointmentModule } from '../appointment/appointment.module';
import { EncounterModule } from '../encounter/encounter.module';
import { BillingModule } from '../billing/billing.module';

/**
 * Module điều phối (Sprint 3, Tiếp nhận) — không sở hữu bảng nghiệp vụ nào của riêng nó trừ
 * `vital_sign` (`VitalSignRepository`) và `encounter_service_item` (`EncounterServiceItemRepository`,
 * docs/DECISIONS.md #080). `imports: [AppointmentModule, EncounterModule]` để dùng
 * `AppointmentRepository`/`EncounterRepository` mà 2 module đó export — cả 2 thao tác (tạo
 * encounter, cập nhật appointment) phải nằm trong CÙNG 1 transaction check-in, nên không dùng
 * port (port tự mở transaction riêng — xem docs/DECISIONS.md quyết định kiến trúc).
 * `imports: [..., BillingModule]` (Sprint 5/6, Thu ngân cơ bản) — dùng `InvoiceRepository` để tự
 * động tạo phiếu thu trong CÙNG transaction check-in/tiếp nhận trực tiếp, cùng lý do trên.
 */
@Module({
  imports: [AppointmentModule, EncounterModule, BillingModule],
  controllers: [ReceptionController],
  providers: [ReceptionService, VitalSignRepository, EncounterServiceItemRepository],
})
export class ReceptionModule {}
