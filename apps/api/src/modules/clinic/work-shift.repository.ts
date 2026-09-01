import { Injectable } from '@nestjs/common';
import type { Prisma, WorkShift } from '@prisma/client';

export interface CreateWorkShiftData {
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  color: string;
  restStartTime: string | null;
  restEndTime: string | null;
  restMinutes: number | null;
  standardWorkMinutes: number | null;
  sortOrder: number;
}

export interface UpdateWorkShiftData {
  name?: string;
  startTime?: string;
  endTime?: string;
  color?: string;
  restStartTime?: string | null;
  restEndTime?: string | null;
  restMinutes?: number | null;
  standardWorkMinutes?: number | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `work_shift` — theo .claude/docs/coding-standards.md. */
@Injectable()
export class WorkShiftRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateWorkShiftData): Promise<WorkShift> {
    return tx.workShift.create({
      data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<WorkShift | null> {
    return tx.workShift.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  findByCode(tx: Prisma.TransactionClient, tenantId: string, code: string): Promise<WorkShift | null> {
    return tx.workShift.findFirst({ where: { tenantId, code, deletedAt: null } });
  }

  /** Không phân trang — cùng lý do `RoomRepository.list` (số ca của một phòng khám rất nhỏ). */
  list(tx: Prisma.TransactionClient, tenantId: string): Promise<WorkShift[]> {
    return tx.workShift.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { startTime: 'asc' }],
    });
  }

  /** `updateMany` + kiểm `count` — cùng lý do `RoomRepository.updateIfVersionMatches`. */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateWorkShiftData,
  ): Promise<number> {
    const result = await tx.workShift.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
