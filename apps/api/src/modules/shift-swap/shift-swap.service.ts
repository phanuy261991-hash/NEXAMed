import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  APPOINTMENT_IMPACT_READER_PORT,
  CLINIC_CONFIG_READER_PORT,
  ConcurrentModificationError,
  DOCTOR_DIRECTORY_PORT,
  LEAVE_READER_PORT,
  SYSTEM_ACTOR_ID,
  ShiftSwapBlockedError,
  ShiftSwapExpiredError,
  ShiftSwapInvalidStatusError,
  ShiftSwapNotAllowedActorError,
  getVietnamDateString,
  isMonthLocked,
  isMonthOpenForSelfRegistration,
  leaveWindowFromShift,
  windowsOverlap,
  type AppointmentImpactReaderPort,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
  type LeaveReaderPort,
} from '@nexamed/core';
import type {
  AcceptShiftSwapRequest,
  CancelShiftSwapRequest,
  CreateShiftSwapRequest,
  DataScope,
  DeclineShiftSwapRequest,
  ListShiftSwapCandidatesResponse,
  ListShiftSwapColleaguesResponse,
  ListShiftSwapsQuery,
  ListShiftSwapsResponse,
  ShiftSwapAssignmentRef,
  ShiftSwapCheckResponse,
  ShiftSwapCountResponse,
  ShiftSwapItem,
  ShiftSwapStatus,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { WorkScheduleSubmissionRepository } from '../work-shift-assignment/work-schedule-submission.repository';
import { WorkShiftAssignmentRepository, type WorkShiftAssignmentRow } from '../work-shift-assignment/work-shift-assignment.repository';
import { ShiftSwapRepository, type ShiftSwapRow } from './shift-swap.repository';

const dateOf = (a: { workDate: Date }) => a.workDate.toISOString().slice(0, 10);

function toRef(a: WorkShiftAssignmentRow): ShiftSwapAssignmentRef {
  return {
    assignmentId: a.id,
    workDate: dateOf(a),
    workShiftId: a.workShiftId,
    workShiftName: a.workShift.name,
    startTime: a.workShift.startTime,
    endTime: a.workShift.endTime,
  };
}

/**
 * "Đổi ca" (#225) — A đưa ca X, nhận ca Y của B. Chỉ B xác nhận; xác nhận xong đổi chủ 2 ca ngay (xoá mềm + tạo
 * mới, giữ lịch sử); quản lý chỉ xem. Ca KHÔNG đổi được khi: đã qua, tháng khoá, tháng chưa được duyệt (chế độ có
 * duyệt), đang có yêu cầu đổi khác, có đơn nghỉ chồng khung, hoặc có lịch hẹn đã đặt trong khung ca. Mọi đọc qua
 * port chạy NGOÀI transaction ghi.
 */
@Injectable()
export class ShiftSwapService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: ShiftSwapRepository,
    private readonly assignmentRepository: WorkShiftAssignmentRepository,
    private readonly submissionRepository: WorkScheduleSubmissionRepository,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(LEAVE_READER_PORT) private readonly leaveReader: LeaveReaderPort,
    @Inject(APPOINTMENT_IMPACT_READER_PORT) private readonly impactReader: AppointmentImpactReaderPort,
  ) {}

  // ---------------------------------------------------------------- kiểm tra điều kiện

  /** Lý do ca KHÔNG đổi được, hoặc `null` nếu đổi được. `exceptRequestId`: bỏ qua chính yêu cầu đang xử lý. */
  private async blockedReason(tenantId: string, a: WorkShiftAssignmentRow, today: string, exceptRequestId?: string): Promise<string | null> {
    const date = dateOf(a);
    if (date < today) return 'Ca đã qua.';
    const month = date.slice(0, 7);

    const graceDays = await this.clinicConfigReader.getWorkShiftAssignmentLockGraceDays(tenantId);
    if (isMonthLocked(month, today, graceDays)) return 'Lịch tháng này đã khoá.';

    if ((await this.clinicConfigReader.getAllowStaffSelfScheduleEnabled(tenantId)) && isMonthOpenForSelfRegistration(month, today)) {
      const statuses = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.submissionRepository.statusByMonth(tx, tenantId, a.userId, [month]));
      if ((statuses.get(month) ?? 'DRAFT') !== 'APPROVED') return 'Lịch tháng này chưa được duyệt nên chưa đổi ca được.';
    }

    const pending = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.hasPendingForAssignment(tx, tenantId, a.id, exceptRequestId));
    if (pending) return 'Ca này đang có một yêu cầu đổi ca khác.';

    const window = leaveWindowFromShift(a.workShift.startTime, a.workShift.endTime);
    const leaves = await this.leaveReader.getLeaveInRange(tenantId, [a.userId], date, date);
    if (leaves.some((l) => windowsOverlap(window, { startMinute: l.startMinute, endMinute: l.endMinute }))) return 'Ca này đang có đơn xin nghỉ.';

    const [appointments] = await this.impactReader.listScheduledInWindows(tenantId, [
      { doctorId: a.userId, date, startMinute: window.startMinute, endMinute: window.endMinute },
    ]);
    if (appointments && appointments.length > 0) return `Đang có ${appointments.length} lịch hẹn trong ca này.`;
    return null;
  }

  /** Kiểm cả cặp ca + trùng ca của người nhận; ném `ShiftSwapBlockedError` kèm lý do cụ thể. */
  private async assertPairSwappable(tenantId: string, mine: WorkShiftAssignmentRow, theirs: WorkShiftAssignmentRow, today: string, exceptRequestId?: string): Promise<void> {
    const [mineReason, theirsReason] = await Promise.all([
      this.blockedReason(tenantId, mine, today, exceptRequestId),
      this.blockedReason(tenantId, theirs, today, exceptRequestId),
    ]);
    if (mineReason) throw new ShiftSwapBlockedError(`Ca của bạn: ${mineReason}`);
    if (theirsReason) throw new ShiftSwapBlockedError(`Ca của đồng nghiệp: ${theirsReason}`);
    if (dateOf(mine) === dateOf(theirs) && mine.workShiftId === theirs.workShiftId) {
      throw new ShiftSwapBlockedError('Hai ca giống nhau (cùng ngày, cùng ca) nên không cần đổi.');
    }
    // Người nhận không được đã có đúng ca sắp nhận (unique `(user, ngày, ca)`).
    const [mineDay, theirsDay] = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => [
      await this.assignmentRepository.listForUsersOnDate(tx, tenantId, [mine.userId], dateOf(theirs)),
      await this.assignmentRepository.listForUsersOnDate(tx, tenantId, [theirs.userId], dateOf(mine)),
    ]);
    if (mineDay.some((r) => r.id !== mine.id && r.workShiftId === theirs.workShiftId)) throw new ShiftSwapBlockedError('Bạn đã có ca của đồng nghiệp vào ngày đó.');
    if (theirsDay.some((r) => r.id !== theirs.id && r.workShiftId === mine.workShiftId)) throw new ShiftSwapBlockedError('Đồng nghiệp đã có ca của bạn vào ngày đó.');
  }

  private isExpired(row: ShiftSwapRow, today: string): boolean {
    const earliest = [dateOf(row.requesterAssignment), dateOf(row.counterpartAssignment)].sort()[0] as string;
    return earliest < today;
  }

  // ---------------------------------------------------------------- thao tác

  async create(tenantId: string, actorId: string, dto: CreateShiftSwapRequest, meta: RequestMeta): Promise<ShiftSwapItem> {
    const today = getVietnamDateString();
    const [mine, theirs] = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => [
      await this.assignmentRepository.findById(tx, tenantId, dto.requesterAssignmentId),
      await this.assignmentRepository.findById(tx, tenantId, dto.counterpartAssignmentId),
    ]);
    // Ca của người khác/không tồn tại → 404 (không lộ ca ngoài phạm vi).
    if (!mine || mine.userId !== actorId || !theirs || theirs.userId === actorId) throw new NotFoundException();
    await this.assertPairSwappable(tenantId, mine, theirs, today);

    const row = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let created: ShiftSwapRow;
      try {
        created = await this.repository.create(tx, tenantId, actorId, {
          requesterId: actorId,
          requesterAssignmentId: mine.id,
          counterpartId: theirs.userId,
          counterpartAssignmentId: theirs.id,
          note: dto.note?.trim() ? dto.note.trim() : null,
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ShiftSwapBlockedError('Ca này đang có một yêu cầu đổi ca khác.');
        }
        throw err;
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'shift_swap.created',
        entityType: 'shift_swap',
        entityId: created.id,
        afterJson: { requesterAssignmentId: mine.id, counterpartId: theirs.userId, counterpartAssignmentId: theirs.id },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return created;
    });
    const [item] = await this.toItems(tenantId, actorId, 'personal', [row]);
    return item as ShiftSwapItem;
  }

  /** Người NHẬN xác nhận → đổi chủ 2 ca ngay trong một transaction. */
  async accept(tenantId: string, actorId: string, id: string, dto: AcceptShiftSwapRequest, meta: RequestMeta): Promise<ShiftSwapItem> {
    const today = getVietnamDateString();
    const row = await this.getRow(tenantId, id);
    if (row.counterpartId !== actorId) throw new ShiftSwapNotAllowedActorError();
    if (row.status !== 'PENDING') throw new ShiftSwapInvalidStatusError();
    if (this.isExpired(row, today)) throw new ShiftSwapExpiredError();

    // Đọc lại 2 ca (có thể đã bị quản lý sửa/xoá từ lúc gửi) rồi kiểm lại toàn bộ điều kiện.
    const [mine, theirs] = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => [
      await this.assignmentRepository.findById(tx, tenantId, row.requesterAssignmentId),
      await this.assignmentRepository.findById(tx, tenantId, row.counterpartAssignmentId),
    ]);
    if (!mine || !theirs || mine.userId !== row.requesterId || theirs.userId !== row.counterpartId) {
      throw new ShiftSwapBlockedError('Ca đã bị thay đổi sau khi gửi yêu cầu — không đổi được nữa.');
    }
    await this.assertPairSwappable(tenantId, mine, theirs, today, row.id);

    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const deletedMine = await this.assignmentRepository.softDelete(tx, tenantId, mine.id, mine.version, actorId, 'Đổi ca');
      const deletedTheirs = await this.assignmentRepository.softDelete(tx, tenantId, theirs.id, theirs.version, actorId, 'Đổi ca');
      if (deletedMine === 0 || deletedTheirs === 0) throw new ConcurrentModificationError();
      try {
        // Ca mới đứng tên `SYSTEM_ACTOR_ID` (không phải người dùng) → nhân viên không tự xoá được ca vừa đổi.
        await this.assignmentRepository.create(tx, tenantId, row.requesterId, theirs.workShiftId, dateOf(theirs), SYSTEM_ACTOR_ID);
        await this.assignmentRepository.create(tx, tenantId, row.counterpartId, mine.workShiftId, dateOf(mine), SYSTEM_ACTOR_ID);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ShiftSwapBlockedError('Một trong hai người đã có ca này vào ngày đó — không đổi được.');
        }
        throw err;
      }
      const count = await this.repository.transition(tx, tenantId, id, dto.version, { status: 'ACCEPTED' }, actorId);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'shift_swap.accepted',
        entityType: 'shift_swap',
        entityId: id,
        beforeJson: { status: 'PENDING' },
        afterJson: {
          status: 'ACCEPTED',
          requesterId: row.requesterId,
          counterpartId: row.counterpartId,
          requesterGives: { workDate: dateOf(mine), workShiftId: mine.workShiftId },
          counterpartGives: { workDate: dateOf(theirs), workShiftId: theirs.workShiftId },
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.getItem(tenantId, actorId, 'personal', id);
  }

  async decline(tenantId: string, actorId: string, id: string, dto: DeclineShiftSwapRequest, meta: RequestMeta): Promise<ShiftSwapItem> {
    const row = await this.getRow(tenantId, id);
    if (row.counterpartId !== actorId) throw new ShiftSwapNotAllowedActorError();
    if (row.status !== 'PENDING') throw new ShiftSwapInvalidStatusError();
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.repository.transition(tx, tenantId, id, dto.version, { status: 'DECLINED', declineReason: dto.reason?.trim() ? dto.reason.trim() : null }, actorId);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'shift_swap.declined',
        entityType: 'shift_swap',
        entityId: id,
        beforeJson: { status: 'PENDING' },
        afterJson: { status: 'DECLINED' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.getItem(tenantId, actorId, 'personal', id);
  }

  /** Người GỬI huỷ khi người nhận chưa xác nhận. */
  async cancel(tenantId: string, actorId: string, id: string, dto: CancelShiftSwapRequest, meta: RequestMeta): Promise<ShiftSwapItem> {
    const row = await this.getRow(tenantId, id);
    if (row.requesterId !== actorId) throw new ShiftSwapNotAllowedActorError();
    if (row.status !== 'PENDING') throw new ShiftSwapInvalidStatusError();
    await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const count = await this.repository.transition(tx, tenantId, id, dto.version, { status: 'CANCELLED' }, actorId);
      if (count === 0) throw new ConcurrentModificationError();
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'shift_swap.cancelled',
        entityType: 'shift_swap',
        entityId: id,
        beforeJson: { status: 'PENDING' },
        afterJson: { status: 'CANCELLED' },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.getItem(tenantId, actorId, 'personal', id);
  }

  // ---------------------------------------------------------------- đọc

  async list(tenantId: string, actorId: string, dataScope: DataScope, query: ListShiftSwapsQuery): Promise<ListShiftSwapsResponse> {
    const today = getVietnamDateString();
    // `EXPIRED` là trạng thái dẫn xuất từ `PENDING` → đọc `PENDING` rồi lọc theo hạn.
    const dbStatus = query.status === 'EXPIRED' ? 'PENDING' : query.status;
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      this.repository.list(tx, tenantId, { status: dbStatus as 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | undefined, involvingUserId: dataScope === 'personal' ? actorId : undefined }),
    );
    const filtered = rows.filter((r) => {
      if (query.status === 'EXPIRED') return this.isExpired(r, today);
      if (query.status === 'PENDING') return !this.isExpired(r, today);
      return true;
    });
    return { items: await this.toItems(tenantId, actorId, dataScope, filtered) };
  }

  /** Số yêu cầu đang chờ MÌNH xác nhận (còn hạn) — dải thông báo "Lịch làm việc của tôi". */
  async incomingCount(tenantId: string, actorId: string): Promise<ShiftSwapCountResponse> {
    const today = getVietnamDateString();
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.listPendingForCounterpart(tx, tenantId, actorId));
    return { count: rows.filter((r) => !this.isExpired(r, today)).length };
  }

  async unseenCount(tenantId: string): Promise<ShiftSwapCountResponse> {
    return { count: await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.countUnseen(tx, tenantId)) };
  }

  async markSeen(tenantId: string, actorId: string): Promise<ShiftSwapCountResponse> {
    return { count: await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.markSeen(tx, tenantId, actorId)) };
  }

  /** Đồng nghiệp có ca sắp tới (trừ chính mình). */
  async colleagues(tenantId: string, actorId: string): Promise<ListShiftSwapColleaguesResponse> {
    const today = getVietnamDateString();
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.listUpcomingAssignments(tx, tenantId, today, actorId));
    const userIds = [...new Set(rows.map((r) => r.userId))];
    if (userIds.length === 0) return { items: [] };
    const [names, doctors, departmentNames] = await Promise.all([
      this.doctorDirectory.getUserFullNames(tenantId, userIds),
      this.doctorDirectory.listActiveDoctors(tenantId),
      this.doctorDirectory.getDepartmentNames(tenantId),
    ]);
    const doctorById = new Map(doctors.map((d) => [d.id, d]));
    return {
      items: userIds
        .map((userId) => ({
          userId,
          fullName: names.get(userId) ?? '—',
          departmentName: doctorById.get(userId)?.departmentId ? (departmentNames.get(doctorById.get(userId)!.departmentId!) ?? null) : null,
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi')),
    };
  }

  /** Ca sắp tới của một đồng nghiệp kèm cờ đổi được/lý do chặn — chọn "ca bạn nhận". */
  async colleagueAssignments(tenantId: string, actorId: string, userId: string): Promise<ListShiftSwapCandidatesResponse> {
    if (userId === actorId) throw new NotFoundException();
    const today = getVietnamDateString();
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.listUpcomingAssignments(tx, tenantId, today, actorId, userId));
    const items = await Promise.all(
      rows.map(async (a) => {
        const blockedReason = await this.blockedReason(tenantId, a, today);
        return { ...toRef(a), swappable: blockedReason === null, blockedReason };
      }),
    );
    return { items };
  }

  /** Kiểm một ca CỦA MÌNH có đổi được không (cảnh báo trong hộp Đổi ca trước khi chọn ca nhận). */
  async checkOwnAssignment(tenantId: string, actorId: string, assignmentId: string): Promise<ShiftSwapCheckResponse> {
    const a = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.assignmentRepository.findById(tx, tenantId, assignmentId));
    if (!a || a.userId !== actorId) throw new NotFoundException();
    const blockedReason = await this.blockedReason(tenantId, a, getVietnamDateString());
    return { swappable: blockedReason === null, blockedReason };
  }

  // ---------------------------------------------------------------- nội bộ

  private async getRow(tenantId: string, id: string): Promise<ShiftSwapRow> {
    const row = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.repository.findById(tx, tenantId, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async getItem(tenantId: string, actorId: string, dataScope: DataScope, id: string): Promise<ShiftSwapItem> {
    const [item] = await this.toItems(tenantId, actorId, dataScope, [await this.getRow(tenantId, id)]);
    return item as ShiftSwapItem;
  }

  private async toItems(tenantId: string, actorId: string, dataScope: DataScope, rows: ShiftSwapRow[]): Promise<ShiftSwapItem[]> {
    if (rows.length === 0) return [];
    const today = getVietnamDateString();
    const names = await this.doctorDirectory.getUserFullNames(tenantId, [...new Set(rows.flatMap((r) => [r.requesterId, r.counterpartId]))]);
    return rows.map((r) => {
      const expired = r.status === 'PENDING' && this.isExpired(r, today);
      const status: ShiftSwapStatus = expired ? 'EXPIRED' : (r.status as ShiftSwapStatus);
      return {
        id: r.id,
        requesterId: r.requesterId,
        requesterName: names.get(r.requesterId) ?? '—',
        requesterAssignment: toRef(r.requesterAssignment),
        counterpartId: r.counterpartId,
        counterpartName: names.get(r.counterpartId) ?? '—',
        counterpartAssignment: toRef(r.counterpartAssignment),
        note: r.note,
        status,
        respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
        declineReason: r.declineReason,
        createdAt: r.createdAt.toISOString(),
        isNewForManager: dataScope === 'global' && r.managerSeenAt === null,
        canRespond: r.counterpartId === actorId && status === 'PENDING',
        canCancel: r.requesterId === actorId && r.status === 'PENDING',
        version: r.version,
      };
    });
  }
}
