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
import { WorkShiftController } from './work-shift.controller';
import { WorkShiftService } from './work-shift.service';
import { WorkShiftRepository } from './work-shift.repository';
import { BusinessCodeService } from './business-code.service';

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
 * `WorkShiftController` (docs/DECISIONS.md #101) — "Ca làm việc", danh mục mẫu ca RIÊNG theo
 * tenant (khác `reference_catalog` toàn hệ thống), cùng `clinic_config.*`.
 * `BusinessCodeService` (docs/DECISIONS.md #114) — "Cấu hình mẫu mã phát sinh", export cho
 * `patient`/`iam`(department,user-account)/`appointment`/`reception`/`billing`/`cashier-shift`
 * dùng trong CÙNG transaction (đúng khuôn "reception/encounter/appointment chia sẻ Repository",
 * #042) thay `formatDisplayCode`+`CodeSequenceRepository.next()` gọi trực tiếp trước đây.
 */
@Module({
  controllers: [
    RoomController,
    ClinicSettingsController,
    ClinicProfileController,
    DoctorRoomSessionController,
    FloorController,
    ExamStationController,
    WorkShiftController,
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
    WorkShiftService,
    WorkShiftRepository,
    BusinessCodeService,
    { provide: CLINIC_CONFIG_READER_PORT, useExisting: ClinicSettingsService },
  ],
  // `WorkShiftService` export thêm cho `WorkShiftAssignmentModule` (Nhập Excel — tra mã ca, thuần
  // đọc `list()` có sẵn, không cần port riêng cho một lệnh đọc). `BusinessCodeService` export cho
  // mọi module sinh mã nghiệp vụ (docs/DECISIONS.md #114).
  exports: [CLINIC_CONFIG_READER_PORT, WorkShiftService, BusinessCodeService],
})
export class ClinicModule {}
