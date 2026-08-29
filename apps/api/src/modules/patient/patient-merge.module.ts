import { Module } from '@nestjs/common';
import { PatientModule } from './patient.module';
import { EncounterModule } from '../encounter/encounter.module';
import { PatientMergeController } from './patient-merge.controller';
import { PatientMergeService } from './patient-merge.service';

/**
 * Gộp hồ sơ trùng (S5-06, PAT-04) — module điều phối RIÊNG, không gộp vào `PatientModule` vì
 * chạm bảng `encounter` (module khác) trong CÙNG 1 transaction, đúng "chia sẻ Repository giữa
 * module trong 1 transaction" đã dùng ở `ReceptionModule` (docs/DECISIONS.md). `imports:
 * [PatientModule, EncounterModule]` để dùng `PatientRepository`/`PatientAllergenRepository`/
 * `PatientConditionRepository`/`PatientFamilyHistoryRepository` (đã export từ `PatientModule`)
 * và `EncounterRepository` (đã export từ `EncounterModule`).
 */
@Module({
  imports: [PatientModule, EncounterModule],
  controllers: [PatientMergeController],
  providers: [PatientMergeService],
})
export class PatientMergeModule {}
