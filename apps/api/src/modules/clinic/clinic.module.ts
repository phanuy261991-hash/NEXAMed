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
import { DoctorRoomSessionController } from './doctor-room-session.controller';
import { DoctorRoomSessionService } from './doctor-room-session.service';
import { DoctorRoomSessionRepository } from './doctor-room-session.repository';
import { FloorController } from './floor.controller';
import { FloorService } from './floor.service';
import { FloorRepository } from './floor.repository';
import { ExamStationController } from './exam-station.controller';
import { ExamStationService } from './exam-station.service';
import { ExamStationRepository } from './exam-station.repository';

/**
 * S2-07, ADM-02 (trừ mẫu in) — cấu hình phòng khám, phòng (.claude/docs/architecture.md).
 * Export `CLINIC_CONFIG_READER_PORT` (S2-09) để `AppointmentModule` inject qua `imports:
 * [ClinicModule]` — chỉ phụ thuộc token port, không import thẳng `ClinicSettingsService`/
 * `ClinicSettingsRepository` (.claude/docs/coding-standards.md mục "Ranh giới module").
 * `ClinicProfileController/Service/Repository` (2026-08-13) — trang "Thông tin phòng khám", dùng
 * lại `clinic_config.read`/`.update`, không thêm permission mới.
 * `DoctorRoomSessionController/Service/Repository` (#054) — "phòng làm việc hôm nay" của bác sĩ,
 * tự-phục vụ (không permission mới); `ClinicSettingsService` inject thêm
 * `DoctorRoomSessionRepository` để hiện thực `getTodayDoctorRoomAssignments` của port.
 * `FloorController`/`ExamStationController` (#055) — "Tầng"/"Bàn khám-Ghế", cấp cha/con tùy chọn
 * của `room`, cùng `clinic_config.*`. `RoomService` inject thêm `ExamStationRepository` để trả
 * `examStationCount` trong `RoomSummary`.
 */
@Module({
  controllers: [
    RoomController,
    ClinicSettingsController,
    ClinicProfileController,
    DoctorRoomSessionController,
    FloorController,
    ExamStationController,
  ],
  providers: [
    RoomService,
    RoomRepository,
    ClinicSettingsService,
    ClinicSettingsRepository,
    ClinicProfileService,
    ClinicProfileRepository,
    DoctorRoomSessionService,
    DoctorRoomSessionRepository,
    FloorService,
    FloorRepository,
    ExamStationService,
    ExamStationRepository,
    { provide: CLINIC_CONFIG_READER_PORT, useExisting: ClinicSettingsService },
  ],
  exports: [CLINIC_CONFIG_READER_PORT],
})
export class ClinicModule {}
