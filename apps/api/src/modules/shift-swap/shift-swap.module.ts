import { Module } from '@nestjs/common';
import { ClinicModule } from '../clinic/clinic.module';
import { WorkShiftAssignmentModule } from '../work-shift-assignment/work-shift-assignment.module';
import { ShiftSwapController } from './shift-swap.controller';
import { ShiftSwapRepository } from './shift-swap.repository';
import { ShiftSwapService } from './shift-swap.service';

/**
 * "Đổi ca" (#225). `imports: [WorkShiftAssignmentModule]` để dùng repository ca đăng ký + bảng duyệt tháng
 * (module đó export), `ClinicModule` cho `CLINIC_CONFIG_READER_PORT`; `DOCTOR_DIRECTORY_PORT`,
 * `LEAVE_READER_PORT`, `APPOINTMENT_IMPACT_READER_PORT` đều đã `@Global()`.
 */
@Module({
  imports: [ClinicModule, WorkShiftAssignmentModule],
  controllers: [ShiftSwapController],
  providers: [ShiftSwapService, ShiftSwapRepository],
})
export class ShiftSwapModule {}
