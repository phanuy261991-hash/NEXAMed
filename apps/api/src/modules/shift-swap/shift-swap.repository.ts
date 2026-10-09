import { Injectable } from '@nestjs/common';
import type { Prisma, ShiftSwapRequest, WorkShift, WorkShiftAssignment } from '@prisma/client';

type AssignmentWithShift = WorkShiftAssignment & { workShift: WorkShift };
export type ShiftSwapRow = ShiftSwapRequest & { requesterAssignment: AssignmentWithShift; counterpartAssignment: AssignmentWithShift };

const INCLUDE = {
  requesterAssignment: { include: { workShift: true } },
  counterpartAssignment: { include: { workShift: true } },
} satisfies Prisma.ShiftSwapRequestInclude;

const LIST_TAKE_LIMIT = 300;

/**
 * Chỗ DUY NHẤT gọi Prisma cho bảng `shift_swap_request` ("Đổi ca", #225). Partial unique chặn 2 yêu cầu
 * `PENDING` cùng một ca ở migration — service bắt `P2002`.
 */
@Injectable()
export class ShiftSwapRepository {
  create(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    data: { requesterId: string; requesterAssignmentId: string; counterpartId: string; counterpartAssignmentId: string; note: string | null },
  ): Promise<ShiftSwapRow> {
    return tx.shiftSwapRequest.create({
      data: { tenantId, ...data, status: 'PENDING', createdBy: actorId, updatedBy: actorId },
      include: INCLUDE,
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<ShiftSwapRow | null> {
    return tx.shiftSwapRequest.findFirst({ where: { tenantId, id, deletedAt: null }, include: INCLUDE });
  }

  /** `involvingUserId` = chỉ yêu cầu người đó gửi hoặc nhận (scope personal); bỏ trống = cả phòng khám (global). */
  list(tx: Prisma.TransactionClient, tenantId: string, filter: { status?: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED'; involvingUserId?: string }): Promise<ShiftSwapRow[]> {
    const where: Prisma.ShiftSwapRequestWhereInput = { tenantId, deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.involvingUserId) where.OR = [{ requesterId: filter.involvingUserId }, { counterpartId: filter.involvingUserId }];
    return tx.shiftSwapRequest.findMany({ where, include: INCLUDE, orderBy: [{ createdAt: 'desc' }], take: LIST_TAKE_LIMIT });
  }

  listPendingForCounterpart(tx: Prisma.TransactionClient, tenantId: string, counterpartId: string): Promise<ShiftSwapRow[]> {
    return tx.shiftSwapRequest.findMany({ where: { tenantId, counterpartId, status: 'PENDING', deletedAt: null }, include: INCLUDE });
  }

  /** Ca đang nằm trong một yêu cầu đổi ca CHỜ khác (loại trừ chính yêu cầu `exceptRequestId`). */
  async hasPendingForAssignment(tx: Prisma.TransactionClient, tenantId: string, assignmentId: string, exceptRequestId?: string): Promise<boolean> {
    const count = await tx.shiftSwapRequest.count({
      where: {
        tenantId,
        status: 'PENDING',
        deletedAt: null,
        ...(exceptRequestId ? { id: { not: exceptRequestId } } : {}),
        OR: [{ requesterAssignmentId: assignmentId }, { counterpartAssignmentId: assignmentId }],
      },
    });
    return count > 0;
  }

  /** Chuyển trạng thái từ `PENDING` (khoá lạc quan). Đặt lại `managerSeenAt=NULL` → quản lý thấy "Mới". */
  async transition(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    version: number,
    data: { status: 'ACCEPTED' | 'DECLINED' | 'CANCELLED'; declineReason?: string | null },
    actorId: string,
  ): Promise<number> {
    const result = await tx.shiftSwapRequest.updateMany({
      where: { tenantId, id, version, status: 'PENDING', deletedAt: null },
      data: { status: data.status, respondedAt: new Date(), declineReason: data.declineReason ?? null, managerSeenAt: null, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  countUnseen(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    return tx.shiftSwapRequest.count({ where: { tenantId, managerSeenAt: null, deletedAt: null } });
  }

  async markSeen(tx: Prisma.TransactionClient, tenantId: string, actorId: string): Promise<number> {
    const result = await tx.shiftSwapRequest.updateMany({
      where: { tenantId, managerSeenAt: null, deletedAt: null },
      data: { managerSeenAt: new Date(), updatedBy: actorId },
    });
    return result.count;
  }

  /** Ca sắp tới (từ `fromDate`) của mọi nhân viên trừ `excludeUserId` — nguồn danh sách đồng nghiệp. */
  listUpcomingAssignments(tx: Prisma.TransactionClient, tenantId: string, fromDate: string, excludeUserId: string, userId?: string): Promise<AssignmentWithShift[]> {
    return tx.workShiftAssignment.findMany({
      where: { tenantId, deletedAt: null, workDate: { gte: new Date(fromDate) }, userId: userId ? userId : { not: excludeUserId } },
      include: { workShift: true },
      orderBy: [{ workDate: 'asc' }],
      take: 400,
    });
  }
}
