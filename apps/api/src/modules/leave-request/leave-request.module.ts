import { Module } from '@nestjs/common';
import { WorkShiftAssignmentModule } from '../work-shift-assignment/work-shift-assignment.module';
import { LeaveRequestController } from './leave-request.controller';
import { LeaveRequestService } from './leave-request.service';
import { LeaveRequestRepository } from './leave-request.repository';

/**
 * "Đơn xin nghỉ" (#224). `imports: [WorkShiftAssignmentModule]` chỉ để inject
 * `WORK_SHIFT_ASSIGNMENT_READER_PORT` (kiểm ca đã đăng ký), cùng khuôn `AppointmentModule`.
 * `DOCTOR_DIRECTORY_PORT` đã global ở `IamModule`; `APPOINTMENT_IMPACT_READER_PORT` ở
 * `AppointmentImpactReaderModule` (`@Global()`). `exports: [LeaveRequestRepository]` để adapter
 * `LeaveReaderAdapter` dùng (Prisma thuần, không chia sẻ logic nghiệp vụ).
 */
@Module({
  imports: [WorkShiftAssignmentModule],
  controllers: [LeaveRequestController],
  providers: [LeaveRequestService, LeaveRequestRepository],
  exports: [LeaveRequestRepository],
})
export class LeaveRequestModule {}
