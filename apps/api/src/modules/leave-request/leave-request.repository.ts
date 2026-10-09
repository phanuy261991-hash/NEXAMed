import { Injectable } from '@nestjs/common';
import type { LeaveRequest, Prisma, WorkShift } from '@prisma/client';
import type { LeaveRequestStatus } from '@nexamed/shared';

export type LeaveRequestRow = LeaveRequest & { workShift: WorkShift | null };

/** Trạng thái còn hiệu lực — chặn trùng/chồng lấn và chặn đặt lịch dựa trên nhóm này. */
export const ACTIVE_LEAVE_STATUSES: LeaveRequestStatus[] = ['PENDING', 'APPROVED'];

const LIST_TAKE_LIMIT = 500;

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `leave_request` (.claude/docs/coding-standards.md). Partial unique
 * `leave_request_active_unique` (expression COALESCE + WHERE) không khai báo được ở schema.prisma
 * nhưng Prisma vẫn map `unique_violation` về `P2002` — service bắt ở `create()`.
 */
@Injectable()
export class LeaveRequestRepository {
  create(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    data: {
      userId: string;
      leaveDate: string;
      workShiftId: string | null;
      startMinute: number;
      endMinute: number;
      status: LeaveRequestStatus;
      reason: string;
      filedOnBehalf: boolean;
      decidedBy: string | null;
      decidedAt: Date | null;
    },
  ): Promise<LeaveRequestRow> {
    return tx.leaveRequest.create({
      data: {
        tenantId,
        userId: data.userId,
        leaveDate: new Date(data.leaveDate),
        workShiftId: data.workShiftId,
        startMinute: data.startMinute,
        endMinute: data.endMinute,
        status: data.status,
        reason: data.reason,
        filedOnBehalf: data.filedOnBehalf,
        decidedBy: data.decidedBy,
        decidedAt: data.decidedAt,
        createdBy: actorId,
        updatedBy: actorId,
      },
      include: { workShift: true },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<LeaveRequestRow | null> {
    return tx.leaveRequest.findFirst({ where: { tenantId, id, deletedAt: null }, include: { workShift: true } });
  }

  /** Đơn còn hiệu lực (chờ duyệt/đã duyệt) của 1 người trong 1 ngày — kiểm chồng lấn khung giờ. */
  listActiveForUserOnDate(tx: Prisma.TransactionClient, tenantId: string, userId: string, date: string): Promise<LeaveRequest[]> {
    return tx.leaveRequest.findMany({
      where: { tenantId, userId, leaveDate: new Date(date), status: { in: ACTIVE_LEAVE_STATUSES }, deletedAt: null },
    });
  }

  list(
    tx: Prisma.TransactionClient,
    tenantId: string,
    filter: { status?: LeaveRequestStatus; from?: string; to?: string; userId?: string },
  ): Promise<LeaveRequestRow[]> {
    const where: Prisma.LeaveRequestWhereInput = { tenantId, deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.userId) where.userId = filter.userId;
    if (filter.from || filter.to) {
      where.leaveDate = {
        ...(filter.from ? { gte: new Date(filter.from) } : {}),
        ...(filter.to ? { lte: new Date(filter.to) } : {}),
      };
    }
    return tx.leaveRequest.findMany({
      where,
      include: { workShift: true },
      orderBy: [{ leaveDate: 'desc' }, { createdAt: 'desc' }],
      take: LIST_TAKE_LIMIT,
    });
  }

  countByStatus(tx: Prisma.TransactionClient, tenantId: string, status: LeaveRequestStatus): Promise<number> {
    return tx.leaveRequest.count({ where: { tenantId, status, deletedAt: null } });
  }

  /** Đơn chờ duyệt/đã duyệt của nhiều người trong khoảng ngày — nguồn cho `LeaveReaderPort`. */
  listActiveInRange(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userIds: string[],
    from: string,
    to: string,
  ): Promise<LeaveRequestRow[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    return tx.leaveRequest.findMany({
      where: {
        tenantId,
        userId: { in: userIds },
        leaveDate: { gte: new Date(from), lte: new Date(to) },
        status: { in: ACTIVE_LEAVE_STATUSES },
        deletedAt: null,
      },
      include: { workShift: true },
    });
  }

  /**
   * Chuyển trạng thái có điều kiện: chỉ khi đúng `version` VÀ đang ở một trong `fromStatuses`
   * (optimistic lock + chặn race hai người cùng duyệt). Trả số dòng đổi được.
   */
  async transition(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    version: number,
    fromStatuses: LeaveRequestStatus[],
    data: { status: LeaveRequestStatus; decidedBy?: string | null; decidedAt?: Date | null; decisionReason?: string | null },
    actorId: string,
  ): Promise<number> {
    const result = await tx.leaveRequest.updateMany({
      where: { tenantId, id, version, status: { in: fromStatuses }, deletedAt: null },
      data: {
        status: data.status,
        ...(data.decidedBy !== undefined ? { decidedBy: data.decidedBy } : {}),
        ...(data.decidedAt !== undefined ? { decidedAt: data.decidedAt } : {}),
        ...(data.decisionReason !== undefined ? { decisionReason: data.decisionReason } : {}),
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
    return result.count;
  }
}
