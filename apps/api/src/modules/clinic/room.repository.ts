import { Injectable } from '@nestjs/common';
import type { Prisma, Room } from '@prisma/client';

export interface CreateRoomData {
  name: string;
}

export interface UpdateRoomData {
  name?: string;
  isActive?: boolean;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `room` — theo .claude/docs/coding-standards.md. */
@Injectable()
export class RoomRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateRoomData): Promise<Room> {
    return tx.room.create({
      data: { tenantId, name: data.name, createdBy: actorId, updatedBy: actorId },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Room | null> {
    return tx.room.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Không phân trang — xem lý do trong `packages/shared/src/clinic.ts` (listRoomsResponseSchema). */
  list(tx: Prisma.TransactionClient, tenantId: string): Promise<Room[]> {
    return tx.room.findMany({ where: { tenantId, deletedAt: null }, orderBy: { name: 'asc' } });
  }

  /** `updateMany` + kiểm `count` — cùng lý do `PatientRepository.updateIfVersionMatches`. */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateRoomData,
  ): Promise<number> {
    const result = await tx.room.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
