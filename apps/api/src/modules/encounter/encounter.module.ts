import { Module } from '@nestjs/common';
import { PatientModule } from '../patient/patient.module';
import { ClinicModule } from '../clinic/clinic.module';
import { EncounterController } from './encounter.controller';
import { EncounterService } from './encounter.service';
import { EncounterRepository } from './encounter.repository';
import { DiagnosisRepository } from './diagnosis.repository';
import { ClinicalNoteRepository } from './clinical-note.repository';
import { PrescriptionRepository } from './prescription.repository';

/**
 * `exports: [EncounterRepository]` — `ReceptionModule` dùng chung trong transaction check-in (xem
 * docs/DECISIONS.md). `imports: [PatientModule]` (Sprint 4, kê đơn) — đọc `PatientAllergenRepository`
 * trong cùng transaction để tính cảnh báo dị ứng (PRE-03), cùng tinh thần chia sẻ Repository đã có.
 * `imports: [..., ClinicModule]` (Thu ngân cơ bản, Sprint 5/6) — inject `CLINIC_CONFIG_READER_PORT`
 * (`getDeferredPaymentEnabled`) để gate "Bắt đầu khám"/"Nhận ca" theo trạng thái thanh toán, cùng
 * mẫu `AppointmentModule` đã dùng port này từ S2-09.
 */
@Module({
  imports: [PatientModule, ClinicModule],
  controllers: [EncounterController],
  providers: [EncounterService, EncounterRepository, DiagnosisRepository, ClinicalNoteRepository, PrescriptionRepository],
  exports: [EncounterRepository],
})
export class EncounterModule {}
