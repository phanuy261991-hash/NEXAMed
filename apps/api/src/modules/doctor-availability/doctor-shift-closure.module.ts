import { Global, Module } from '@nestjs/common';
import { DOCTOR_SHIFT_CLOSURE_PORT } from '@nexamed/core';
import { ClinicModule } from '../clinic/clinic.module';
import { EncounterModule } from '../encounter/encounter.module';
import { WorkShiftAssignmentModule } from '../work-shift-assignment/work-shift-assignment.module';
import { DoctorAvailabilityRepository } from './doctor-availability.repository';
import { DoctorShiftClosureService } from './doctor-shift-closure.service';

/**
 * Module RIÊNG chỉ để bind `DOCTOR_SHIFT_CLOSURE_PORT` — cùng khuôn `LeaveReaderModule`: `EncounterService` chỉ
 * `@Inject` token mà không import `DoctorAvailabilityModule` (tránh vòng `EncounterModule ⇄ DoctorAvailabilityModule`,
 * vì module kia đã `imports: [EncounterModule]`). `@Global()` để không phải khai báo ở `imports`.
 */
@Global()
@Module({
  imports: [EncounterModule, WorkShiftAssignmentModule, ClinicModule],
  providers: [DoctorAvailabilityRepository, DoctorShiftClosureService, { provide: DOCTOR_SHIFT_CLOSURE_PORT, useExisting: DoctorShiftClosureService }],
  exports: [DOCTOR_SHIFT_CLOSURE_PORT, DoctorShiftClosureService],
})
export class DoctorShiftClosureModule {}
