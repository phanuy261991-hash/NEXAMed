import { Module } from '@nestjs/common';
import { EncounterModule } from '../encounter/encounter.module';
import { ClinicModule } from '../clinic/clinic.module';
import { DoctorAvailabilityController } from './doctor-availability.controller';
import { DoctorAvailabilityService } from './doctor-availability.service';
import { DoctorAvailabilityRepository } from './doctor-availability.repository';

/**
 * `imports: [EncounterModule]` — dùng chung `EncounterRepository` trong CÙNG transaction "Đóng ca"
 * (bulk `releaseAllForDoctor()` phải atomic với việc ghi `doctor_availability`), đúng tiền lệ #042
 * "reception/encounter/appointment chia sẻ Repository giữa module trong 1 transaction, không dùng
 * port" — cùng mẫu `ReceptionModule`. `imports: [ClinicModule]` — inject `CLINIC_CONFIG_READER_PORT`
 * (`getDoctorAvailabilityPolicy`), cùng mẫu `AppointmentModule`/`EncounterModule` đã dùng port này.
 */
@Module({
  imports: [EncounterModule, ClinicModule],
  controllers: [DoctorAvailabilityController],
  providers: [DoctorAvailabilityService, DoctorAvailabilityRepository],
})
export class DoctorAvailabilityModule {}
