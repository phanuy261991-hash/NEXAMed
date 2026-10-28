import { Inject, Injectable } from '@nestjs/common';
import {
  CLINIC_CONFIG_READER_PORT,
  LEAVE_READER_PORT,
  WORK_SHIFT_ASSIGNMENT_READER_PORT,
  computePendingClosureDates,
  getVietnamDateString,
  latestShiftEndTime,
  pendingClosureWindow,
  vietnamDayRange,
  type ClinicConfigReaderPort,
  type DoctorShiftClosurePort,
  type LeaveReaderPort,
  type PendingClosureDay,
  type WorkShiftAssignmentReaderPort,
} from '@nexamed/core';
import type { DoctorClosingState } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { EncounterRepository } from '../encounter/encounter.repository';
import { DoctorAvailabilityRepository } from './doctor-availability.repository';

/**
 * "Phiên trước chưa đóng thì chưa được khám" + giờ nhắc đóng ca theo ca đã xếp (mockup duyệt 28/10/2026).
 * Cũng là adapter của `DoctorShiftClosurePort` cho `EncounterService`.
 *
 * Mọi lời gọi cổng (`WorkShiftAssignmentReaderPort`, `LeaveReaderPort`) tự mở transaction riêng nên được gọi TUẦN TỰ
 * và NGOÀI các transaction của chính service này — "một request = MỘT transaction" (CLAUDE.md, #264).
 */
@Injectable()
export class DoctorShiftClosureService implements DoctorShiftClosurePort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly availabilityRepository: DoctorAvailabilityRepository,
    private readonly encounterRepository: EncounterRepository,
    @Inject(WORK_SHIFT_ASSIGNMENT_READER_PORT) private readonly shiftReader: WorkShiftAssignmentReaderPort,
    @Inject(LEAVE_READER_PORT) private readonly leaveReader: LeaveReaderPort,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  async listPendingClosures(tenantId: string, branchId: string, actorId: string, doctorId: string): Promise<PendingClosureDay[]> {
    const byDoctor = await this.listForDoctors(tenantId, branchId, actorId, [doctorId]);
    return byDoctor.get(doctorId) ?? [];
  }

  /** Các ngày chưa đóng của NHIỀU bác sĩ một lần (dải nhắc của lễ tân). Bác sĩ không có ngày nào thì không có key. */
  async listForDoctors(tenantId: string, branchId: string, actorId: string, doctorIds: string[]): Promise<Map<string, PendingClosureDay[]>> {
    const result = new Map<string, PendingClosureDay[]>();
    if (doctorIds.length === 0) return result;

    // Phòng khám tắt "Bắt buộc đóng ca ngày trước" (Cấu hình khám): không chặn, không dải nhắc, và chưa ghi mốc áp dụng — bật lại sau này thì mốc là ngày bật, không dồn ngày cũ.
    if (!(await this.clinicConfigReader.getRequirePreviousShiftClosed(tenantId))) return result;

    const today = getVietnamDateString();
    const enforcedFrom = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.availabilityRepository.ensureEnforcedFrom(tx, tenantId, today, actorId));
    const window = pendingClosureWindow(today, enforcedFrom);
    if (!window) return result;

    const assigned = await this.shiftReader.listAssignedShiftsInRange(tenantId, branchId, doctorIds, window.from, window.to);
    const leave = await this.leaveReader.getLeaveInRange(tenantId, branchId, doctorIds, window.from, window.to);

    const range = { startUtc: vietnamDayRange(window.from).startUtc, endUtc: vietnamDayRange(window.to).endUtc };
    const { encounters, ended } = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => ({
      encounters: await this.encounterRepository.listDoctorEncountersInRange(tx, tenantId, branchId, doctorIds, range),
      ended: await this.availabilityRepository.listEndedDates(tx, tenantId, doctorIds, window.from, window.to),
    }));

    for (const doctorId of doctorIds) {
      const shiftsByDate = new Map<string, Array<{ startTime: string; endTime: string }>>();
      for (const shift of assigned[doctorId] ?? []) {
        const list = shiftsByDate.get(shift.date) ?? [];
        list.push({ startTime: shift.startTime, endTime: shift.endTime });
        shiftsByDate.set(shift.date, list);
      }
      const counts = new Map<string, PendingClosureDay>();
      for (const row of encounters) {
        if (row.doctorId !== doctorId) continue;
        const date = getVietnamDateString(row.startedAt ?? row.checkedInAt);
        const day = counts.get(date) ?? { date, calledCount: 0, completedCount: 0, unprocessedCount: 0, shifts: shiftsByDate.get(date) ?? [] };
        if (row.startedAt !== null) day.calledCount += 1;
        if (row.status === 'COMPLETED') day.completedCount += 1;
        if (row.status === 'CHECKED_IN' || row.status === 'IN_CONSULTATION') day.unprocessedCount += 1;
        counts.set(date, day);
      }
      const dates = computePendingClosureDates({
        from: window.from,
        to: window.to,
        workedDates: counts.keys(),
        assignedDates: (assigned[doctorId] ?? []).map((shift) => shift.date),
        wholeDayLeaveDates: leave.filter((l) => l.userId === doctorId && l.status === 'APPROVED' && l.isWholeDay).map((l) => l.date),
        endedDates: ended.get(doctorId) ?? [],
      });
      if (dates.length > 0) {
        result.set(
          doctorId,
          dates.map((date) => counts.get(date) ?? { date, calledCount: 0, completedCount: 0, unprocessedCount: 0, shifts: shiftsByDate.get(date) ?? [] }),
        );
      }
    }
    return result;
  }

  /** `GET /doctor-availability/me/closing-state` — các ngày chưa đóng + GIỜ nhắc đóng ca hôm nay (theo ca đã xếp). */
  async getClosingState(tenantId: string, branchId: string, actorId: string, doctorId: string): Promise<DoctorClosingState> {
    // Phòng khám tắt "Nhắc và bắt buộc đóng ca" (Cấu hình khám): không nhắc đóng ca, không có ngày nào bị chặn.
    if (!(await this.clinicConfigReader.getRequirePreviousShiftClosed(tenantId))) {
      return { pendingDays: [], todayClosingTime: null, todayClosingSource: 'DISABLED' };
    }
    const pendingDays = await this.listPendingClosures(tenantId, branchId, actorId, doctorId);
    const today = getVietnamDateString();
    const shifts = await this.shiftReader.listShiftsForUserOnDate(tenantId, branchId, doctorId, today);
    if (shifts.length === 0) {
      return { pendingDays, todayClosingTime: null, todayClosingSource: null };
    }
    const leave = await this.leaveReader.getLeaveInRange(tenantId, branchId, [doctorId], today, today);
    if (leave.some((l) => l.status === 'APPROVED' && l.isWholeDay)) {
      return { pendingDays, todayClosingTime: null, todayClosingSource: 'LEAVE' };
    }
    return { pendingDays, todayClosingTime: latestShiftEndTime(shifts), todayClosingSource: 'SHIFT' };
  }
}
