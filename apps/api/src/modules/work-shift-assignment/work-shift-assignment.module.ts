import { Module } from '@nestjs/common';
import { WORK_SHIFT_ASSIGNMENT_READER_PORT } from '@nexamed/core';
import { WorkShiftAssignmentController } from './work-shift-assignment.controller';
import { WorkShiftAssignmentService } from './work-shift-assignment.service';
import { WorkShiftAssignmentRepository } from './work-shift-assignment.repository';

/**
 * "Đăng ký ca làm việc" (Giai đoạn 2 của #101) — module MỚI, tách khỏi `clinic` (nơi sở hữu danh
 * mục mẫu ca `work_shift`) vì đây là dữ liệu cá nhân của MỌI nhân viên, không phải cấu hình phòng
 * khám. Export `WORK_SHIFT_ASSIGNMENT_READER_PORT` để `AppointmentModule` inject qua `imports:
 * [WorkShiftAssignmentModule]` — chỉ phụ thuộc token port, đúng khuôn `ClinicModule`/
 * `CLINIC_CONFIG_READER_PORT` (.claude/docs/coding-standards.md mục "Ranh giới module").
 */
@Module({
  controllers: [WorkShiftAssignmentController],
  providers: [
    WorkShiftAssignmentService,
    WorkShiftAssignmentRepository,
    { provide: WORK_SHIFT_ASSIGNMENT_READER_PORT, useExisting: WorkShiftAssignmentService },
  ],
  exports: [WORK_SHIFT_ASSIGNMENT_READER_PORT],
})
export class WorkShiftAssignmentModule {}
