import { Module } from '@nestjs/common';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import { PatientRepository } from './patient.repository';

/** CodeSequenceRepository không khai báo ở đây — đăng ký global trong PersistenceModule (dùng
 * chung cho mọi domain sinh mã hiển thị: patient_code hôm nay, encounter_no ở S3). */
@Module({
  controllers: [PatientController],
  providers: [PatientService, PatientRepository],
})
export class PatientModule {}
