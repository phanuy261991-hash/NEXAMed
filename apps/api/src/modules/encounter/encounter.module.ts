import { Module } from '@nestjs/common';
import { ENCOUNTER_READER_PORT } from '@nexamed/core';
import { PatientModule } from '../patient/patient.module';
import { ClinicModule } from '../clinic/clinic.module';
import { BillingModule } from '../billing/billing.module';
import { PrintTemplateModule } from '../print-template/print-template.module';
import { GeoModule } from '../geo/geo.module';
import { EncounterController } from './encounter.controller';
import { EncounterService } from './encounter.service';
import { EncounterRepository } from './encounter.repository';
import { DiagnosisRepository } from './diagnosis.repository';
import { ClinicalNoteRepository } from './clinical-note.repository';
import { PrescriptionRepository } from './prescription.repository';
import { DiagnosisSuggestionService } from './diagnosis-suggestion.service';
import { Icd10SuggestionRepository } from './icd10-suggestion.repository';
import { EncounterReaderAdapter } from '../../infrastructure/encounter/encounter-reader.adapter';

/**
 * `exports: [EncounterRepository]` — `ReceptionModule` dùng chung trong transaction check-in (xem
 * docs/DECISIONS.md). `imports: [PatientModule]` (Sprint 4, kê đơn) — đọc `PatientAllergenRepository`
 * trong cùng transaction để tính cảnh báo dị ứng (PRE-03), cùng tinh thần chia sẻ Repository đã có.
 * `imports: [..., ClinicModule]` (Thu ngân cơ bản, Sprint 5/6) — inject `CLINIC_CONFIG_READER_PORT`
 * (`getDeferredPaymentEnabled`) để gate "Bắt đầu khám"/"Nhận ca" theo trạng thái thanh toán, cùng
 * mẫu `AppointmentModule` đã dùng port này từ S2-09.
 * `imports: [..., BillingModule]` (#085, huỷ lượt khám + hoàn tiền) — dùng chung `InvoiceRepository`
 * trong CÙNG transaction huỷ lượt khám để đóng phiếu thu chưa thu đúng lúc, đúng "chia sẻ
 * Repository giữa module trong 1 transaction" (`docs/DECISIONS.md` #042).
 * `ENCOUNTER_READER_PORT` (S5-05, ADM-03) — `AuditModule` inject để resolve mã lượt khám + bệnh
 * nhân cho nhật ký hoạt động, đúng khuôn `PATIENT_READER_PORT` export từ `PatientModule`.
 * `exports: [..., PrescriptionRepository]` — "Đóng ca hôm nay" (popup tổng hợp) cần đếm đơn thuốc
 * đã ký hôm nay của bác sĩ, `DoctorAvailabilityModule` đã `imports: [EncounterModule]` sẵn (dùng
 * chung `EncounterRepository`) nên dùng chung luôn `PrescriptionRepository`, đúng tiền lệ #042.
 * `imports: [..., GeoModule]` (S6-06, ADM-05) — "Xuất bệnh án PDF" tra tên Tỉnh/Phường-Xã theo mã
 * để in địa chỉ đầy đủ (`patient.address` chỉ lưu mã, xem `GeoRepository.findProvincesByCodes()`).
 * `exports: [..., PrescriptionRepository]` cũng phục vụ `InventoryModule` (Kho Thuốc GĐ3, #163) —
 * `StockIssueService` dùng chung để đọc/validate đơn thuốc lúc "Phát thuốc". Chiều phụ thuộc CHỈ
 * MỘT phía (`InventoryModule → EncounterModule`, import thường không cần `forwardRef`) — module này
 * KHÔNG import `InventoryModule` (đã bỏ cùng lúc gỡ "Tự động phát thuốc lúc ký đơn", #165).
 * `exports: [..., DiagnosisRepository]` — "Mã đơn thuốc thật" (#169) — `StockIssueService` đọc
 * chẩn đoán chính để hiện ở khối thông tin màn "Phát thuốc", cùng tiền lệ chia sẻ Repository đã có
 * với `PrescriptionRepository` ở trên (không cần port riêng cho một lệnh đọc đơn giản).
 * Kho Thuốc GĐ5 (cảnh báo/chặn kê vượt tồn) — `EncounterService` inject `STOCK_AVAILABILITY_PORT`
 * (packages/core) qua `@Inject()` thẳng token, KHÔNG thêm `InventoryModule`/`StockAvailabilityModule`
 * vào `imports` ở trên — giữ đúng nguyên tắc một chiều đã ghi. `StockAvailabilityModule` (module
 * `inventory`) đăng ký token này dạng `@Global()`, tự `imports: [InventoryModule]` phía nó.
 */
@Module({
  imports: [PatientModule, ClinicModule, BillingModule, GeoModule, PrintTemplateModule],
  controllers: [EncounterController],
  providers: [
    EncounterService,
    EncounterRepository,
    DiagnosisRepository,
    ClinicalNoteRepository,
    PrescriptionRepository,
    DiagnosisSuggestionService,
    Icd10SuggestionRepository,
    { provide: ENCOUNTER_READER_PORT, useClass: EncounterReaderAdapter },
  ],
  exports: [EncounterRepository, PrescriptionRepository, DiagnosisRepository, ENCOUNTER_READER_PORT],
})
export class EncounterModule {}
