import { Module } from '@nestjs/common';
import { WORK_SHIFT_ASSIGNMENT_READER_PORT } from '@nexamed/core';
import { IamModule } from '../iam/iam.module';
import { ClinicModule } from '../clinic/clinic.module';
import { WorkShiftAssignmentController } from './work-shift-assignment.controller';
import { WorkShiftAssignmentService } from './work-shift-assignment.service';
import { WorkShiftAssignmentRepository } from './work-shift-assignment.repository';
import { WorkShiftAssignmentImportService } from './work-shift-assignment-import.service';
import { WorkScheduleSubmissionController } from './work-schedule-submission.controller';
import { WorkScheduleSubmissionService } from './work-schedule-submission.service';
import { WorkScheduleSubmissionRepository } from './work-schedule-submission.repository';

/**
 * "Đăng ký ca làm việc" (Giai đoạn 2 của #101) — module MỚI, tách khỏi `clinic` (nơi sở hữu danh
 * mục mẫu ca `work_shift`) vì đây là dữ liệu cá nhân của MỌI nhân viên, không phải cấu hình phòng
 * khám. Export `WORK_SHIFT_ASSIGNMENT_READER_PORT` để `AppointmentModule` inject qua `imports:
 * [WorkShiftAssignmentModule]` — chỉ phụ thuộc token port, đúng khuôn `ClinicModule`/
 * `CLINIC_CONFIG_READER_PORT` (.claude/docs/coding-standards.md mục "Ranh giới module").
 */
@Module({
  imports: [IamModule, ClinicModule],
  controllers: [WorkShiftAssignmentController, WorkScheduleSubmissionController],
  providers: [
    WorkShiftAssignmentService,
    WorkShiftAssignmentRepository,
    WorkShiftAssignmentImportService,
    WorkScheduleSubmissionService,
    WorkScheduleSubmissionRepository,
    { provide: WORK_SHIFT_ASSIGNMENT_READER_PORT, useExisting: WorkShiftAssignmentService },
  ],
  exports: [WORK_SHIFT_ASSIGNMENT_READER_PORT, WorkShiftAssignmentRepository, WorkScheduleSubmissionRepository],
})
export class WorkShiftAssignmentModule {}
