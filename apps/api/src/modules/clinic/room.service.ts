import { Injectable, NotFoundException } from '@nestjs/common';
import { ConcurrentModificationError } from '@nexamed/core';
import type { CreateRoomRequest, ListRoomsResponse, RoomSummary, UpdateRoomRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { RoomRepository, type RoomWithFloor, type UpdateRoomData } from './room.repository';
import { ExamStationRepository } from './exam-station.repository';

/**
 * Quản lý phòng khám vật lý (S2-07, ADM-02) — module `clinic` (.claude/docs/architecture.md).
 * Mở rộng (docs/DECISIONS.md #055): `floorId` (tùy chọn, cấp cha) + `examStationCount` (cấp con,
 * chỉ đếm để hiển thị badge — quản lý chi tiết bàn khám qua `ExamStationController` riêng).
 */
@Injectable()
export class RoomService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly roomRepository: RoomRepository,
    private readonly examStationRepository: ExamStationRepository,
  ) {}

  async createRoom(tenantId: string, actorId: string, dto: CreateRoomRequest, meta: RequestMeta): Promise<RoomSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const created = await this.roomRepository.create(tx, tenantId, actorId, { name: dto.name, floorId: dto.floorId });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'room.created',
        entityType: 'room',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const withFloor = await this.roomRepository.findById(tx, tenantId, created.id);
      return this.toSummary(withFloor!, 0);
    });
  }

  async listRooms(tenantId: string): Promise<ListRoomsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.roomRepository.list(tx, tenantId);
      const counts = await this.examStationRepository.countByRoomIds(tx, tenantId, rows.map((r) => r.id));
      return { items: rows.map((r) => this.toSummary(r, counts[r.id] ?? 0)) };
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
      if (dto.floorId !== undefined) patch.floorId = dto.floorId;
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
      const counts = await this.examStationRepository.countByRoomIds(tx, tenantId, [id]);
      return this.toSummary(updated, counts[id] ?? 0);
    });
  }

  private toSummary(room: RoomWithFloor, examStationCount: number): RoomSummary {
    return {
      id: room.id,
      name: room.name,
      floorId: room.floorId,
      floorName: room.floor?.name ?? null,
      examStationCount,
      isActive: room.isActive,
      version: room.version,
    };
  }
}
