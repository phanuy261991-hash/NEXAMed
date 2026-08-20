import { Module } from '@nestjs/common';
import { EncounterController } from './encounter.controller';
import { EncounterService } from './encounter.service';
import { EncounterRepository } from './encounter.repository';
import { DiagnosisRepository } from './diagnosis.repository';
import { ClinicalNoteRepository } from './clinical-note.repository';

/** `exports: [EncounterRepository]` — `ReceptionModule` dùng chung trong transaction check-in (xem docs/DECISIONS.md). */
@Module({
  controllers: [EncounterController],
  providers: [EncounterService, EncounterRepository, DiagnosisRepository, ClinicalNoteRepository],
  exports: [EncounterRepository],
})
export class EncounterModule {}
