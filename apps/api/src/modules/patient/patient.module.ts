import { Module } from '@nestjs/common';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import { PatientRepository } from './patient.repository';
import { PatientAllergenRepository } from './patient-allergen.repository';
import { PatientConditionRepository } from './patient-condition.repository';
import { PatientFamilyHistoryRepository } from './patient-family-history.repository';

/**
 * CodeSequenceRepository không khai báo ở đây — đăng ký global trong PersistenceModule (dùng
 * chung cho mọi domain sinh mã hiển thị: patient_code hôm nay, encounter_no ở S3).
 * `exports: [PatientAllergenRepository, PatientConditionRepository, PatientFamilyHistoryRepository]`
 * — `EncounterModule` đọc dị nguyên (kê đơn, PRE-03), bệnh lý nền/thói quen và tiền sử gia đình
 * (màn khám, chỉ xem — Sprint 5) của bệnh nhân trong cùng transaction, cùng tinh thần
 * `EncounterRepository` được `ReceptionModule` dùng chung.
 */
@Module({
  controllers: [PatientController],
  providers: [PatientService, PatientRepository, PatientAllergenRepository, PatientConditionRepository, PatientFamilyHistoryRepository],
  exports: [PatientAllergenRepository, PatientConditionRepository, PatientFamilyHistoryRepository],
})
export class PatientModule {}
