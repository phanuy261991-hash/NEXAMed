import { Module } from '@nestjs/common';
import { PATIENT_READER_PORT } from '@nexamed/core';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import { PatientRepository } from './patient.repository';
import { PatientAllergenRepository } from './patient-allergen.repository';
import { PatientConditionRepository } from './patient-condition.repository';
import { PatientFamilyHistoryRepository } from './patient-family-history.repository';
import { PatientReaderAdapter } from '../../infrastructure/patient/patient-reader.adapter';

/**
 * CodeSequenceRepository không khai báo ở đây — đăng ký global trong PersistenceModule (dùng
 * chung cho mọi domain sinh mã hiển thị: patient_code hôm nay, encounter_no ở S3).
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
