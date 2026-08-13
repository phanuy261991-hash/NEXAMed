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
 *
 * `exports: [AppointmentRepository]` (Sprint 3, Tiếp nhận) — `ReceptionModule` dùng chung trong
 * cùng transaction check-in (đọc + cập nhật `appointment` VÀ tạo `encounter` atomic, xem
 * docs/DECISIONS.md quyết định kiến trúc). Chỉ export Repository (Prisma thuần), không export
 * Service — đúng ranh giới "không chia sẻ logic nghiệp vụ giữa module" của coding-standards.md.
 */
@Module({
  imports: [ClinicModule],
  controllers: [AppointmentController],
  providers: [AppointmentService, AppointmentRepository],
  exports: [AppointmentRepository],
})
export class AppointmentModule {}
