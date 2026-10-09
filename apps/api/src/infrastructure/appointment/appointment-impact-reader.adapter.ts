import { Injectable } from '@nestjs/common';
import {
  appointmentOverlapsLeaveWindow,
  vietnamDayRange,
  type AffectedAppointment,
  type AppointmentImpactQuery,
  type AppointmentImpactReaderPort,
} from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { AppointmentRepository } from '../../modules/appointment/appointment.repository';

/** Một bác sĩ hiếm khi có quá số này lịch hẹn trong 1 ngày — chặn trên để query không phình vô hạn. */
const MAX_APPOINTMENTS_PER_DAY = 500;

/**
 * Adapter thật cho `AppointmentImpactReaderPort` ("Đơn xin nghỉ", #224) — chỉ đọc lịch hẹn còn
 * `SCHEDULED` của bác sĩ trong ngày rồi lọc chồng lên khung nghỉ. Tự mở transaction riêng. Đăng ký ở
 * `AppointmentImpactReaderModule` (`@Global()`).
 */
@Injectable()
export class AppointmentImpactReaderAdapter implements AppointmentImpactReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly appointmentRepository: AppointmentRepository,
  ) {}

  listScheduledInWindows(tenantId: string, queries: AppointmentImpactQuery[]): Promise<AffectedAppointment[][]> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const results: AffectedAppointment[][] = [];
      for (const q of queries) {
        const { startUtc, endUtc } = vietnamDayRange(q.date);
        const rows = await this.appointmentRepository.list(tx, tenantId, {
          take: MAX_APPOINTMENTS_PER_DAY,
          doctorId: q.doctorId,
          scheduledAtFrom: startUtc,
          scheduledAtTo: endUtc,
          status: 'SCHEDULED',
        });
        results.push(
          rows
            .filter((a) => appointmentOverlapsLeaveWindow(a.scheduledAt, a.durationMinutes, { startMinute: q.startMinute, endMinute: q.endMinute }))
            .map((a) => ({
              id: a.id,
              bookingCode: a.bookingCode,
              fullName: a.fullName,
              phone: a.phone,
              scheduledAt: a.scheduledAt.toISOString(),
              durationMinutes: a.durationMinutes,
            })),
        );
      }
      return results;
    });
  }
}
