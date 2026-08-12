import { Injectable, NotFoundException } from '@nestjs/common';
import type { Room } from '@prisma/client';
import { ConcurrentModificationError } from '@nexamed/core';
import type { CreateRoomRequest, ListRoomsResponse, RoomSummary, UpdateRoomRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { RoomRepository, type UpdateRoomData } from './room.repository';

/** Quản lý phòng khám vật lý (S2-07, ADM-02) — module `clinic` (.claude/docs/architecture.md). */
@Injectable()
export class RoomService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly roomRepository: RoomRepository,
  ) {}

  async createRoom(tenantId: string, actorId: string, dto: CreateRoomRequest, meta: RequestMeta): Promise<RoomSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const created = await this.roomRepository.create(tx, tenantId, actorId, { name: dto.name });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'room.created',
        entityType: 'room',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created);
    });
  }

  async listRooms(tenantId: string): Promise<ListRoomsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.roomRepository.list(tx, tenantId);
      return { items: rows.map((r) => this.toSummary(r)) };
    });
  }

  async updateRoom(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateRoomRequest,
    meta: RequestMeta,
  ): Promise<RoomSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.roomRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const patch: UpdateRoomData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const count = await this.roomRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'room.updated',
        entityType: 'room',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.roomRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  private toSummary(room: Room): RoomSummary {
    return { id: room.id, name: room.name, isActive: room.isActive, version: room.version };
  }
}
