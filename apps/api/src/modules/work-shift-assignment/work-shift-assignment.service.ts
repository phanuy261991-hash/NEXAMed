import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConcurrentModificationError,
  WorkShiftAssignmentDuplicateError,
  WorkShiftAssignmentLockedError,
  getVietnamDateString,
  type PortWorkShiftColor,
  type WorkShiftAssignmentReaderPort,
} from '@nexamed/core';
import type {
  BulkCreateWorkShiftAssignmentRequest,
  CopyWorkShiftAssignmentsRequest,
  CreateWorkShiftAssignmentRequest,
  DataScope,
  ListWorkShiftAssignmentsQuery,
  ListWorkShiftAssignmentsResponse,
  WorkShiftAssignmentBulkResult,
  WorkShiftAssignmentItem,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { WorkShiftAssignmentRepository, type WorkShiftAssignmentRow } from './work-shift-assignment.repository';

function isDuplicateViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function dateStringToUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function dateToDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysToDateString(dateStr: string, days: number): string {
  const d = dateStringToUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToDateString(d);
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((dateStringToUtc(toDateStr).getTime() - dateStringToUtc(fromDateStr).getTime()) / MS_PER_DAY);
}

function monthRange(monthStr: string): { from: string; to: string } {
  const [year, month] = monthStr.split('-').map(Number);
  const from = `${monthStr}-01`;
  // Ngày 0 của tháng kế tiếp = ngày cuối tháng hiện tại (mẹo Date UTC quen thuộc).
  const lastDay = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
  const to = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/** Ngày trong tháng đích tương ứng — trả `null` nếu tháng đích không có đủ số ngày đó (ví dụ ngày
 * 31 của tháng nguồn, tháng đích chỉ có 30 ngày) thay vì để `Date` tự "tràn" sang tháng kế tiếp. */
function mapDayToMonth(day: number, targetMonthStr: string): string | null {
  const [year, month] = targetMonthStr.split('-').map(Number);
  const built = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day));
  if (built.getUTCMonth() !== (month ?? 1) - 1) return null;
  return dateToDateString(built);
}

/**
 * "Đăng ký ca làm việc" (Giai đoạn 2 của #101) — MỌI nhân viên tự đăng ký ca cho chính mình
 * (`create`, scope `personal`); vai trò có quyền `global` (mặc định clinic_admin) xem/sửa/xoá TOÀN
 * BỘ, không giới hạn thời gian. Quy tắc khoá "chỉ tự sửa/xoá trong đúng ngày đăng ký" KHÔNG kiểm
 * được ở `PermissionGuard` (không có khái niệm điều kiện thời gian, xem docstring guard đó) — kiểm
 * ở đây, so `createdAt` (ngày lịch VN) với hôm nay.
 *
 * Cũng hiện thực `WorkShiftAssignmentReaderPort` cho module `appointment` đọc (lưới Lịch hẹn + chặn
 * đặt lịch ngoài ca) — .claude/docs/coding-standards.md "module không import chéo, giao tiếp qua port".
 */
@Injectable()
export class WorkShiftAssignmentService implements WorkShiftAssignmentReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: WorkShiftAssignmentRepository,
  ) {}

  async create(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    dto: CreateWorkShiftAssignmentRequest,
    meta: RequestMeta,
  ): Promise<WorkShiftAssignmentItem> {
    const targetUserId = dataScope === 'personal' ? actorId : (dto.userId ?? actorId);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let created: WorkShiftAssignmentRow;
      try {
        created = await this.repository.create(tx, tenantId, targetUserId, dto.workShiftId, dto.workDate, actorId);
      } catch (err) {
        if (isDuplicateViolation(err)) {
          throw new WorkShiftAssignmentDuplicateError();
        }
        throw err;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'work_shift_assignment.created',
        entityType: 'work_shift_assignment',
        entityId: created.id,
        afterJson: { userId: targetUserId, workShiftId: dto.workShiftId, workDate: dto.workDate },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toItem(created, actorId, dataScope);
    });
  }

  async bulkCreate(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    dto: BulkCreateWorkShiftAssignmentRequest,
    meta: RequestMeta,
  ): Promise<WorkShiftAssignmentBulkResult> {
    const targetUserId = dataScope === 'personal' ? actorId : (dto.userId ?? actorId);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = dto.workDates.map((workDate) => ({
        tenantId,
        userId: targetUserId,
        workShiftId: dto.workShiftId,
        workDate: dateStringToUtc(workDate),
        createdBy: actorId,
        updatedBy: actorId,
      }));
      const createdCount = await this.repository.createManySkipDuplicates(tx, rows);
      const skippedCount = dto.workDates.length - createdCount;

      if (createdCount > 0) {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'work_shift_assignment.bulk_created',
          entityType: 'work_shift_assignment',
          entityId: targetUserId,
          afterJson: { workShiftId: dto.workShiftId, workDates: dto.workDates, createdCount, skippedCount },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      return { createdCount, skippedCount };
    });
  }

  /** "Sao chép tuần/tháng trước" — CHỈ điền vào ngày còn trống, bỏ qua ngày đích đã có sẵn (skip,
   * không ghi đè) VÀ ngày không tồn tại ở tháng đích (chỉ nhánh `mode==='month'`). */
  async copy(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    dto: CopyWorkShiftAssignmentsRequest,
    meta: RequestMeta,
  ): Promise<WorkShiftAssignmentBulkResult> {
    const targetUserId = dataScope === 'personal' ? actorId : (dto.userId ?? actorId);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let sourceRows: WorkShiftAssignmentRow[];
      let targetDates: (string | null)[];

      if (dto.mode === 'week') {
        sourceRows = await this.repository.listForUserInRange(
          tx,
          tenantId,
          targetUserId,
          dto.fromWeekStart,
          addDaysToDateString(dto.fromWeekStart, 6),
        );
        const offsetDays = daysBetween(dto.fromWeekStart, dto.toWeekStart);
        targetDates = sourceRows.map((row) => addDaysToDateString(dateToDateString(row.workDate), offsetDays));
      } else {
        const { from, to } = monthRange(dto.fromMonth);
        sourceRows = await this.repository.listForUserInRange(tx, tenantId, targetUserId, from, to);
        targetDates = sourceRows.map((row) => mapDayToMonth(row.workDate.getUTCDate(), dto.toMonth));
      }

      const rows = sourceRows
        .map((row, i) => ({ row, targetDate: targetDates[i] }))
        .filter((x): x is { row: WorkShiftAssignmentRow; targetDate: string } => x.targetDate !== null && x.targetDate !== undefined)
        .map(({ row, targetDate }) => ({
          tenantId,
          userId: targetUserId,
          workShiftId: row.workShiftId,
          workDate: dateStringToUtc(targetDate),
          createdBy: actorId,
          updatedBy: actorId,
        }));

      const createdCount = await this.repository.createManySkipDuplicates(tx, rows);
      const skippedCount = sourceRows.length - createdCount;

      if (createdCount > 0) {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'work_shift_assignment.copied',
          entityType: 'work_shift_assignment',
          entityId: targetUserId,
          afterJson: { mode: dto.mode, createdCount, skippedCount },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      return { createdCount, skippedCount };
    });
  }

  async remove(tenantId: string, actorId: string, dataScope: DataScope, id: string, version: number, meta: RequestMeta): Promise<void> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findById(tx, tenantId, id);
      if (!existing || (dataScope === 'personal' && existing.userId !== actorId)) {
        // Cùng triết lý 404 (không phải 403) khi ngoài phạm vi cá nhân — .claude/docs/multi-tenancy.md.
        throw new NotFoundException();
      }

      const isSelf = existing.userId === actorId;
      if (dataScope === 'personal') {
        const createdDay = getVietnamDateString(existing.createdAt);
        const today = getVietnamDateString();
        if (createdDay !== today) {
          throw new WorkShiftAssignmentLockedError();
        }
      }

      const count = await this.repository.softDelete(
        tx,
        tenantId,
        id,
        version,
        actorId,
        isSelf ? 'Tự huỷ trong ngày đăng ký' : 'Quản lý xoá ca đã đăng ký',
      );
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'work_shift_assignment.deleted',
        entityType: 'work_shift_assignment',
        entityId: id,
        beforeJson: { userId: existing.userId, workShiftId: existing.workShiftId, workDate: dateToDateString(existing.workDate) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  async list(tenantId: string, actorId: string, dataScope: DataScope, query: ListWorkShiftAssignmentsQuery): Promise<ListWorkShiftAssignmentsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const userId = dataScope === 'personal' ? actorId : query.userId;
      const rows = await this.repository.list(tx, tenantId, { from: query.from, to: query.to, userId });
      return { items: rows.map((row) => this.toItem(row, actorId, dataScope)) };
    });
  }

  /** `WorkShiftAssignmentReaderPort` — dùng cho lưới Lịch hẹn (module `appointment`, qua port). */
  getWorkShiftsForUsersOnDate(
    tenantId: string,
    userIds: string[],
    date: string,
  ): ReturnType<WorkShiftAssignmentReaderPort['getWorkShiftsForUsersOnDate']> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.repository.listForUsersOnDate(tx, tenantId, userIds, date);
      const result: Record<string, Array<{ name: string; color: PortWorkShiftColor; startTime: string; endTime: string }>> = {};
      for (const row of rows) {
        const list = result[row.userId] ?? (result[row.userId] = []);
        list.push({
          name: row.workShift.name,
          color: row.workShift.color as PortWorkShiftColor,
          startTime: row.workShift.startTime,
          endTime: row.workShift.endTime,
        });
      }
      return result;
    });
  }

  private toItem(row: WorkShiftAssignmentRow, actorId: string, dataScope: DataScope): WorkShiftAssignmentItem {
    const canEdit = dataScope === 'global' || (row.userId === actorId && getVietnamDateString(row.createdAt) === getVietnamDateString());
    return {
      id: row.id,
      userId: row.userId,
      workDate: dateToDateString(row.workDate),
      workShiftId: row.workShiftId,
      workShiftName: row.workShift.name,
      workShiftColor: row.workShift.color as WorkShiftAssignmentItem['workShiftColor'],
      startTime: row.workShift.startTime,
      endTime: row.workShift.endTime,
      canEdit,
      version: row.version,
    };
  }
}
