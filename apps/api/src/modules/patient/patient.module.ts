import { Module } from '@nestjs/common';
import { PATIENT_READER_PORT } from '@nexamed/core';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import { PatientRepository } from './patient.repository';
import { PatientAllergenRepository } from './patient-allergen.repository';
import { PatientConditionRepository } from './patient-condition.repository';
import { PatientFamilyHistoryRepository } from './patient-family-history.repository';
import { PatientReaderAdapter } from '../../infrastructure/patient/patient-reader.adapter';
import { ClinicModule } from '../clinic/clinic.module';

/**
 * `imports: [ClinicModule]` (docs/DECISIONS.md #114) — dùng `BusinessCodeService` sinh
 * `patient_code` thay `formatDisplayCode`+`CodeSequenceRepository.next()` gọi trực tiếp trước
 * đây (`CodeSequenceRepository` vẫn đăng ký global trong `PersistenceModule`, không cần khai báo
 * riêng ở đây — chỉ `BusinessCodeService` mới cần import module).
 * `exports: [PatientAllergenRepository, PatientConditionRepository, PatientFamilyHistoryRepository]`
 * — `EncounterModule` đọc dị nguyên (kê đơn, PRE-03), bệnh lý nền/thói quen và tiền sử gia đình
 * (màn khám, chỉ xem — Sprint 5) của bệnh nhân trong cùng transaction, cùng tinh thần
 * `EncounterRepository` được `ReceptionModule` dùng chung.
 * `PATIENT_READER_PORT` (S5-05, ADM-03) — `AuditModule` inject để resolve tên/mã hồ sơ cho nhật ký
 * hoạt động, đúng khuôn `REFERENCE_CATALOG_READER_PORT` export từ `ReferenceCatalogModule`.
 * `PatientRepository` cũng export thẳng (S5-06, PAT-04) — `PatientMergeModule` (module điều phối
 * riêng, xem `patient-merge.module.ts`) cần đọc/ghi `mergedIntoId` trong cùng transaction gộp.
 */
@Module({
  imports: [ClinicModule],
  controllers: [PatientController],
  providers: [
    PatientService,
    PatientRepository,
    PatientAllergenRepository,
    PatientConditionRepository,
    PatientFamilyHistoryRepository,
    { provide: PATIENT_READER_PORT, useClass: PatientReaderAdapter },
  ],
  exports: [PatientRepository, PatientAllergenRepository, PatientConditionRepository, PatientFamilyHistoryRepository, PATIENT_READER_PORT],
})
export class PatientModule {}
