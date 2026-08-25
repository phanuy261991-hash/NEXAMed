import { Module } from '@nestjs/common';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import { PatientRepository } from './patient.repository';
import { PatientAllergenRepository } from './patient-allergen.repository';

/**
 * CodeSequenceRepository không khai báo ở đây — đăng ký global trong PersistenceModule (dùng
 * chung cho mọi domain sinh mã hiển thị: patient_code hôm nay, encounter_no ở S3).
 * `exports: [PatientAllergenRepository]` — `EncounterModule` (kê đơn, PRE-03) đọc dị nguyên của
 * bệnh nhân trong cùng transaction, cùng tinh thần `EncounterRepository` được `ReceptionModule`
 * dùng chung.
 */
@Module({
  controllers: [PatientController],
  providers: [PatientService, PatientRepository, PatientAllergenRepository],
  exports: [PatientAllergenRepository],
})
export class PatientModule {}
