import { Injectable } from '@nestjs/common';
import type { Floor, Prisma } from '@prisma/client';

export interface CreateFloorData {
  name: string;
}

export interface UpdateFloorData {
  name?: string;
  isActive?: boolean;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `floor` (docs/DECISIONS.md #055) — .claude/docs/coding-standards.md. */
@Injectable()
export class FloorRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateFloorData): Promise<Floor> {
    return tx.floor.create({
      data: { tenantId, name: data.name, createdBy: actorId, updatedBy: actorId },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Floor | null> {
    return tx.floor.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Không phân trang — cùng lý do `RoomRepository.list()`. */
  list(tx: Prisma.TransactionClient, tenantId: string): Promise<Floor[]> {
    return tx.floor.findMany({ where: { tenantId, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateFloorData,
  ): Promise<number> {
    const result = await tx.floor.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
