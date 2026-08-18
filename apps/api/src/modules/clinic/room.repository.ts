import { Injectable } from '@nestjs/common';
import type { Prisma, Room } from '@prisma/client';

export interface CreateRoomData {
  name: string;
  floorId?: string | null;
}

export interface UpdateRoomData {
  name?: string;
  floorId?: string | null;
  isActive?: boolean;
}

/** Kèm tên tầng (docs/DECISIONS.md #055) — `RoomService` map sang `RoomSummary.floorName`. */
export type RoomWithFloor = Room & { floor: { name: string } | null };

/** Chỗ DUY NHẤT gọi Prisma cho bảng `room` — theo .claude/docs/coding-standards.md. */
@Injectable()
export class RoomRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateRoomData): Promise<Room> {
    return tx.room.create({
      data: { tenantId, name: data.name, floorId: data.floorId ?? null, createdBy: actorId, updatedBy: actorId },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<RoomWithFloor | null> {
    return tx.room.findFirst({ where: { tenantId, id, deletedAt: null }, include: { floor: { select: { name: true } } } });
  }

  /** Không phân trang — xem lý do trong `packages/shared/src/clinic.ts` (listRoomsResponseSchema). */
  list(tx: Prisma.TransactionClient, tenantId: string): Promise<RoomWithFloor[]> {
    return tx.room.findMany({
      where: { tenantId, deletedAt: null },
      include: { floor: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
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
