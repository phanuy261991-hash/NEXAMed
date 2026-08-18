import { Injectable, NotFoundException } from '@nestjs/common';
import type { Floor } from '@prisma/client';
import { ConcurrentModificationError } from '@nexamed/core';
import type { CreateFloorRequest, FloorSummary, ListFloorsResponse, UpdateFloorRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { FloorRepository, type UpdateFloorData } from './floor.repository';

/** "Tầng" (docs/DECISIONS.md #055) — CRUD, cùng khuôn `RoomService`. */
@Injectable()
export class FloorService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly floorRepository: FloorRepository,
  ) {}

  async createFloor(tenantId: string, actorId: string, dto: CreateFloorRequest, meta: RequestMeta): Promise<FloorSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const created = await this.floorRepository.create(tx, tenantId, actorId, { name: dto.name });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'floor.created',
        entityType: 'floor',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created);
    });
  }

  async listFloors(tenantId: string): Promise<ListFloorsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.floorRepository.list(tx, tenantId);
      return { items: rows.map((f) => this.toSummary(f)) };
    });
  }

  async updateFloor(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateFloorRequest,
    meta: RequestMeta,
  ): Promise<FloorSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.floorRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const patch: UpdateFloorData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const count = await this.floorRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'floor.updated',
        entityType: 'floor',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.floorRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  private toSummary(floor: Floor): FloorSummary {
    return { id: floor.id, name: floor.name, isActive: floor.isActive, version: floor.version };
  }
}
