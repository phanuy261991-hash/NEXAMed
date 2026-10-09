import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  APPOINTMENT_IMPACT_READER_PORT,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  LeaveRequestInvalidStatusError,
  LeaveRequestNoShiftError,
  LeaveRequestNotOwnerError,
  LeaveRequestOverlapError,
  LeaveRequestPastDateError,
  LeaveRequestSelfApproveError,
  WORK_SHIFT_ASSIGNMENT_READER_PORT,
  getVietnamDateString,
  isWholeDayLeaveWindow,
  leaveWindowFromShift,
  windowsOverlap,
  wholeDayLeaveWindow,
  type AffectedAppointment,
  type AppointmentImpactReaderPort,
  type DoctorDirectoryPort,
  type LeaveWindow,
  type WorkShiftAssignmentReaderPort,
} from '@nexamed/core';
import type {
  ApproveLeaveRequestRequest,
  CancelLeaveRequestRequest,
  CreateLeaveRequestOnBehalfRequest,
  CreateLeaveRequestRequest,
  DataScope,
  LeaveRequestAffectedAppointmentsResponse,
  LeaveRequestItem,
  LeaveRequestMyImpactQuery,
  LeaveRequestMyImpactResponse,
  LeaveRequestPendingCountResponse,
  ListLeaveRequestsQuery,
  ListLeaveRequestsResponse,
  RejectLeaveRequestRequest,
  WithdrawLeaveRequestRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { LeaveRequestRepository, type LeaveRequestRow } from './leave-request.repository';

function isDuplicateViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function dateToString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * "Đơn xin nghỉ" (#224) — nhân viên xin nghỉ MỘT NGÀY trên ca đã đăng ký (từng ca hoặc cả ngày),
 * người có `leave_request.approve` duyệt/từ chối. Ca đã đăng ký giữ nguyên; nghỉ là bản ghi riêng.
 * Gọi port đọc (ca đã đăng ký, lịch hẹn bị ảnh hưởng) NGOÀI transaction ghi — adapter tự mở
 * transaction riêng, không lồng vào transaction đang mở (cùng nguyên tắc `AppointmentService`).
 */
@Injectable()
export class LeaveRequestService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: LeaveRequestRepository,
    @Inject(WORK_SHIFT_ASSIGNMENT_READER_PORT) private readonly shiftReader: WorkShiftAssignmentReaderPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(APPOINTMENT_IMPACT_READER_PORT) private readonly impactReader: AppointmentImpactReaderPort,
  ) {}

  /** Xin nghỉ cho CHÍNH MÌNH — đơn `PENDING` chờ duyệt. */
  create(tenantId: string, actorId: string, dto: CreateLeaveRequestRequest, meta: RequestMeta): Promise<LeaveRequestItem> {
    return this.createInternal(tenantId, actorId, actorId, dto, false, meta);
  }

  /** Ghi nghỉ hộ nhân viên — duyệt luôn (người ghi hộ là người quyết định). */
  createOnBehalf(tenantId: string, actorId: string, dto: CreateLeaveRequestOnBehalfRequest, meta: RequestMeta): Promise<LeaveRequestItem> {
    return this.createInternal(tenantId, actorId, dto.userId, dto, true, meta);
  }

  private async createInternal(
    tenantId: string,
    actorId: string,
    targetUserId: string,
    dto: CreateLeaveRequestRequest,
    onBehalf: boolean,
    meta: RequestMeta,
  ): Promise<LeaveRequestItem> {
    if (dto.leaveDate < getVietnamDateString()) {
      throw new LeaveRequestPastDateError();
    }
    const { window, workShiftId } = await this.resolveWindow(tenantId, targetUserId, dto.leaveDate, dto.workShiftId);

    const row = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.listActiveForUserOnDate(tx, tenantId, targetUserId, dto.leaveDate);
      if (existing.some((e) => windowsOverlap(window, { startMinute: e.startMinute, endMinute: e.endMinute }))) {
        throw new LeaveRequestOverlapError();
      }

      let created: LeaveRequestRow;
      try {
        created = await this.repository.create(tx, tenantId, actorId, {
          userId: targetUserId,
          leaveDate: dto.leaveDate,
          workShiftId,
          startMinute: window.startMinute,
          endMinute: window.endMinute,
          status: onBehalf ? 'APPROVED' : 'PENDING',
          reason: dto.reason,
          filedOnBehalf: onBehalf,
          decidedBy: onBehalf ? actorId : null,
          decidedAt: onBehalf ? new Date() : null,
        });
      } catch (err) {
        if (isDuplicateViolation(err)) {
          throw new LeaveRequestOverlapError();
        }
        throw err;
      }

      if (onBehalf) {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'leave_request.filed_on_behalf',
          entityType: 'leave_request',
          entityId: created.id,
          afterJson: { userId: targetUserId, leaveDate: dto.leaveDate, workShiftId },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      } else {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'leave_request.created',
          entityType: 'leave_request',
          entityId: created.id,
          afterJson: { userId: targetUserId, leaveDate: dto.leaveDate, workShiftId },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      return created;
    });

    const [item] = await this.toItems(tenantId, actorId, [row]);
    return item as LeaveRequestItem;
  }

  async list(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    query: ListLeaveRequestsQuery,
  ): Promise<ListLeaveRequestsResponse> {
    // scope `personal`: ép lọc theo chính actor, bỏ qua `userId` client gửi (không dò đơn người khác).
    const userId = dataScope === 'personal' ? actorId : query.userId;
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.repository.list(tx, tenantId, { status: query.status, from: query.from, to: query.to, userId }),
    );
    return { items: await this.toItems(tenantId, actorId, rows) };
  }

  async pendingCount(tenantId: string): Promise<LeaveRequestPendingCountResponse> {
    const count = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.countByStatus(tx, tenantId, 'PENDING'));
    return { count };
  }

  /** Lịch hẹn còn `SCHEDULED` trong khung nghỉ của một đơn — hộp thoại Duyệt. */
  async listAffectedAppointments(tenantId: string, id: string): Promise<LeaveRequestAffectedAppointmentsResponse> {
    const row = await this.getRow(tenantId, id);
    const [items] = await this.impactReader.listScheduledInWindows(tenantId, [
      { doctorId: row.userId, date: dateToString(row.leaveDate), startMinute: row.startMinute, endMinute: row.endMinute },
    ]);
    return { items: items ?? [] };
  }

  /** Dải cảnh báo ở hộp "Xin nghỉ": bao nhiêu lịch hẹn của chính actor nằm trong khung sắp nghỉ. */
  async myImpact(tenantId: string, actorId: string, query: LeaveRequestMyImpactQuery): Promise<LeaveRequestMyImpactResponse> {
    const { window } = await this.resolveWindow(tenantId, actorId, query.leaveDate, query.workShiftId ?? null);
    const [items] = await this.impactReader.listScheduledInWindows(tenantId, [
      { doctorId: actorId, date: query.leaveDate, startMinute: window.startMinute, endMinute: window.endMinute },
    ]);
    return { affectedAppointmentCount: items?.length ?? 0 };
  }

  async approve(tenantId: string, actorId: string, id: string, dto: ApproveLeaveRequestRequest, meta: RequestMeta): Promise<LeaveRequestItem> {
    const row = await this.getRow(tenantId, id);
    if (row.userId === actorId) throw new LeaveRequestSelfApproveError();
    if (row.status !== 'PENDING') throw new LeaveRequestInvalidStatusError();

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.repository.transition(
        tx, tenantId, id, dto.version, ['PENDING'],
        { status: 'APPROVED', decidedBy: actorId, decidedAt: new Date() },
        actorId,
      );
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'leave_request.approved',
        entityType: 'leave_request',
        entityId: id,
        beforeJson: { status: 'PENDING' },
        afterJson: { status: 'APPROVED' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.getItem(tenantId, actorId, id);
  }

  async reject(tenantId: string, actorId: string, id: string, dto: RejectLeaveRequestRequest, meta: RequestMeta): Promise<LeaveRequestItem> {
    const row = await this.getRow(tenantId, id);
    if (row.userId === actorId) throw new LeaveRequestSelfApproveError();
    if (row.status !== 'PENDING') throw new LeaveRequestInvalidStatusError();

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.repository.transition(
        tx, tenantId, id, dto.version, ['PENDING'],
        { status: 'REJECTED', decidedBy: actorId, decidedAt: new Date(), decisionReason: dto.reason },
        actorId,
      );
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'leave_request.rejected',
        entityType: 'leave_request',
        entityId: id,
        beforeJson: { status: 'PENDING' },
        afterJson: { status: 'REJECTED', decisionReason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.getItem(tenantId, actorId, id);
  }

  /** Người gửi tự rút đơn khi chưa duyệt. */
  async withdraw(tenantId: string, actorId: string, id: string, dto: WithdrawLeaveRequestRequest, meta: RequestMeta): Promise<LeaveRequestItem> {
    const row = await this.getRow(tenantId, id);
    if (row.userId !== actorId) throw new LeaveRequestNotOwnerError();
    if (row.status !== 'PENDING') throw new LeaveRequestInvalidStatusError();

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.repository.transition(tx, tenantId, id, dto.version, ['PENDING'], { status: 'WITHDRAWN' }, actorId);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'leave_request.withdrawn',
        entityType: 'leave_request',
        entityId: id,
        beforeJson: { status: 'PENDING' },
        afterJson: { status: 'WITHDRAWN' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.getItem(tenantId, actorId, id);
  }

  /** Quản lý huỷ đơn ĐÃ DUYỆT (bác sĩ đi làm lại) — khung đó mở lại bình thường. */
  async cancel(tenantId: string, actorId: string, id: string, dto: CancelLeaveRequestRequest, meta: RequestMeta): Promise<LeaveRequestItem> {
    const row = await this.getRow(tenantId, id);
    if (row.status !== 'APPROVED') throw new LeaveRequestInvalidStatusError();

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.repository.transition(
        tx, tenantId, id, dto.version, ['APPROVED'],
        { status: 'CANCELLED', decidedBy: actorId, decidedAt: new Date(), decisionReason: dto.reason },
        actorId,
      );
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'leave_request.cancelled',
        entityType: 'leave_request',
        entityId: id,
        beforeJson: { status: 'APPROVED' },
        afterJson: { status: 'CANCELLED', decisionReason: dto.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.getItem(tenantId, actorId, id);
  }

  /**
   * Khung nghỉ từ lựa chọn của người dùng: `workShiftId=null` → cả ngày (cần ≥1 ca đăng ký); ngược
   * lại ca phải nằm trong đăng ký của người xin nghỉ đúng ngày đó. Gọi NGOÀI transaction.
   */
  private async resolveWindow(
    tenantId: string,
    userId: string,
    date: string,
    workShiftId: string | null,
  ): Promise<{ window: LeaveWindow; workShiftId: string | null }> {
    const shifts = await this.shiftReader.listShiftsForUserOnDate(tenantId, userId, date);
    if (shifts.length === 0) throw new LeaveRequestNoShiftError();
    if (workShiftId === null) {
      return { window: wholeDayLeaveWindow(), workShiftId: null };
    }
    const shift = shifts.find((s) => s.workShiftId === workShiftId);
    if (!shift) throw new LeaveRequestNoShiftError();
    return { window: leaveWindowFromShift(shift.startTime, shift.endTime), workShiftId };
  }

  private async getRow(tenantId: string, id: string): Promise<LeaveRequestRow> {
    const row = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.findById(tx, tenantId, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async getItem(tenantId: string, actorId: string, id: string): Promise<LeaveRequestItem> {
    const row = await this.getRow(tenantId, id);
    const [item] = await this.toItems(tenantId, actorId, [row]);
    return item as LeaveRequestItem;
  }

  /** Gắn tên người, khoa, số lịch hẹn bị ảnh hưởng — đọc qua port, NGOÀI mọi transaction ghi. */
  private async toItems(tenantId: string, actorId: string, rows: LeaveRequestRow[]): Promise<LeaveRequestItem[]> {
    if (rows.length === 0) return [];
    const userIds = [...new Set(rows.flatMap((r) => [r.userId, ...(r.decidedBy ? [r.decidedBy] : [])]))];
    const [names, doctors, departmentNames] = await Promise.all([
      this.doctorDirectory.getUserFullNames(tenantId, userIds),
      this.doctorDirectory.listActiveDoctors(tenantId),
      this.doctorDirectory.getDepartmentNames(tenantId),
    ]);
    const doctorById = new Map(doctors.map((d) => [d.id, d]));

    // Chỉ bác sĩ mới có lịch hẹn; chỉ đếm cho đơn còn hiệu lực (chờ duyệt/đã duyệt).
    const countable = rows.filter((r) => (r.status === 'PENDING' || r.status === 'APPROVED') && doctorById.has(r.userId));
    const affected: AffectedAppointment[][] = countable.length
      ? await this.impactReader.listScheduledInWindows(
          tenantId,
          countable.map((r) => ({ doctorId: r.userId, date: dateToString(r.leaveDate), startMinute: r.startMinute, endMinute: r.endMinute })),
        )
      : [];
    const affectedCountById = new Map(countable.map((r, i) => [r.id, affected[i]?.length ?? 0]));

    return rows.map((r) => {
      const doctor = doctorById.get(r.userId);
      return {
        id: r.id,
        userId: r.userId,
        userFullName: names.get(r.userId) ?? '—',
        departmentName: doctor?.departmentId ? (departmentNames.get(doctor.departmentId) ?? null) : null,
        leaveDate: dateToString(r.leaveDate),
        workShiftId: r.workShiftId,
        workShiftName: r.workShift?.name ?? null,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
        isWholeDay: isWholeDayLeaveWindow({ startMinute: r.startMinute, endMinute: r.endMinute }),
        status: r.status as LeaveRequestItem['status'],
        reason: r.reason,
        filedOnBehalf: r.filedOnBehalf,
        decidedByName: r.decidedBy ? (names.get(r.decidedBy) ?? null) : null,
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        decisionReason: r.decisionReason,
        createdAt: r.createdAt.toISOString(),
        affectedAppointmentCount: affectedCountById.get(r.id) ?? 0,
        canWithdraw: r.userId === actorId && r.status === 'PENDING',
        version: r.version,
      };
    });
  }
}
