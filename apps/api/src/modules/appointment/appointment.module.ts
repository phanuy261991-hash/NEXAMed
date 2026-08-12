import { Module } from '@nestjs/common';
import { AppointmentController } from './appointment.controller';
import { AppointmentService } from './appointment.service';
import { AppointmentRepository } from './appointment.repository';
import { ClinicModule } from '../clinic/clinic.module';

/**
 * `imports: [ClinicModule]` (S2-09) — chỉ để inject `CLINIC_CONFIG_READER_PORT` mà `ClinicModule`
 * export, không đụng `ClinicSettingsService`/`ClinicSettingsRepository` trực tiếp
 * (.claude/docs/coding-standards.md mục "Ranh giới module"). `DOCTOR_DIRECTORY_PORT` không cần
 * `imports` riêng — đã đăng ký global ở `IamModule` (docs/DECISIONS.md #025 tiền lệ).
 */
@Module({
  imports: [ClinicModule],
  controllers: [AppointmentController],
  providers: [AppointmentService, AppointmentRepository],
})
export class AppointmentModule {}
