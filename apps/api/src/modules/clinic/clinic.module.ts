import { Module } from '@nestjs/common';
import { CLINIC_CONFIG_READER_PORT } from '@nexamed/core';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { RoomRepository } from './room.repository';
import { ClinicSettingsController } from './clinic-settings.controller';
import { ClinicSettingsService } from './clinic-settings.service';
import { ClinicSettingsRepository } from './clinic-settings.repository';
import { ClinicProfileController } from './clinic-profile.controller';
import { ClinicProfileService } from './clinic-profile.service';
import { ClinicProfileRepository } from './clinic-profile.repository';

/**
 * S2-07, ADM-02 (trừ mẫu in) — cấu hình phòng khám, phòng (.claude/docs/architecture.md).
 * Export `CLINIC_CONFIG_READER_PORT` (S2-09) để `AppointmentModule` inject qua `imports:
 * [ClinicModule]` — chỉ phụ thuộc token port, không import thẳng `ClinicSettingsService`/
 * `ClinicSettingsRepository` (.claude/docs/coding-standards.md mục "Ranh giới module").
 * `ClinicProfileController/Service/Repository` (2026-08-13) — trang "Thông tin phòng khám", dùng
 * lại `clinic_config.read`/`.update`, không thêm permission mới.
 */
@Module({
  controllers: [RoomController, ClinicSettingsController, ClinicProfileController],
  providers: [
    RoomService,
    RoomRepository,
    ClinicSettingsService,
    ClinicSettingsRepository,
    ClinicProfileService,
    ClinicProfileRepository,
    { provide: CLINIC_CONFIG_READER_PORT, useExisting: ClinicSettingsService },
  ],
  exports: [CLINIC_CONFIG_READER_PORT],
})
export class ClinicModule {}
