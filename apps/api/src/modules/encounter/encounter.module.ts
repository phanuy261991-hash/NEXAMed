import { Module } from '@nestjs/common';
import { PatientModule } from '../patient/patient.module';
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
 */
@Module({
  imports: [PatientModule],
  controllers: [EncounterController],
  providers: [EncounterService, EncounterRepository, DiagnosisRepository, ClinicalNoteRepository, PrescriptionRepository],
  exports: [EncounterRepository],
})
export class EncounterModule {}
