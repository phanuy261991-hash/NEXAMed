import { Injectable } from '@nestjs/common';
import type { ExamStation, Prisma } from '@prisma/client';

export interface CreateExamStationData {
  roomId: string;
  name: string;
}

export interface UpdateExamStationData {
  name?: string;
  isActive?: boolean;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `exam_station` (docs/DECISIONS.md #055) — .claude/docs/coding-standards.md. */
@Injectable()
export class ExamStationRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateExamStationData): Promise<ExamStation> {
    return tx.examStation.create({
      data: { tenantId, roomId: data.roomId, name: data.name, createdBy: actorId, updatedBy: actorId },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<ExamStation | null> {
    return tx.examStation.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Scoped theo `roomId` — mỗi phòng luôn ít bàn khám, không phân trang (cùng lý do `RoomRepository.list()`). */
  listByRoom(tx: Prisma.TransactionClient, tenantId: string, roomId: string): Promise<ExamStation[]> {
    return tx.examStation.findMany({ where: { tenantId, roomId, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  /** Đếm theo từng `roomId` — phục vụ cột "Bàn khám" ở danh sách phòng (`RoomSummary.examStationCount`). */
  async countByRoomIds(tx: Prisma.TransactionClient, tenantId: string, roomIds: string[]): Promise<Record<string, number>> {
    if (roomIds.length === 0) return {};
    const rows = await tx.examStation.groupBy({
      by: ['roomId'],
      where: { tenantId, roomId: { in: roomIds }, deletedAt: null },
      _count: { _all: true },
    });
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.roomId] = row._count._all;
    }
    return result;
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateExamStationData,
  ): Promise<number> {
    const result = await tx.examStation.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
