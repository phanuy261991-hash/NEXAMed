import { Module } from '@nestjs/common';
import { CLINIC_CONFIG_READER_PORT } from '@nexamed/core';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { RoomRepository } from './room.repository';
import { ClinicSettingsController } from './clinic-settings.controller';
import { ClinicSettingsService } from './clinic-settings.service';
import { ClinicSettingsRepository } from './clinic-settings.repository';

/**
 * S2-07, ADM-02 (trừ mẫu in) — cấu hình phòng khám, phòng (.claude/docs/architecture.md).
 * Export `CLINIC_CONFIG_READER_PORT` (S2-09) để `AppointmentModule` inject qua `imports:
 * [ClinicModule]` — chỉ phụ thuộc token port, không import thẳng `ClinicSettingsService`/
 * `ClinicSettingsRepository` (.claude/docs/coding-standards.md mục "Ranh giới module").
 */
@Module({
  controllers: [RoomController, ClinicSettingsController],
  providers: [
    RoomService,
    RoomRepository,
    ClinicSettingsService,
    ClinicSettingsRepository,
    { provide: CLINIC_CONFIG_READER_PORT, useExisting: ClinicSettingsService },
  ],
  exports: [CLINIC_CONFIG_READER_PORT],
})
export class ClinicModule {}
