import { Injectable, NotFoundException } from '@nestjs/common';
import type { ExamStation } from '@prisma/client';
import { ConcurrentModificationError } from '@nexamed/core';
import type {
  CreateExamStationRequest,
  ExamStationSummary,
  ListExamStationsResponse,
  UpdateExamStationRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { RoomRepository } from './room.repository';
import { ExamStationRepository, type UpdateExamStationData } from './exam-station.repository';

/** "Bàn khám / Ghế" (docs/DECISIONS.md #055) — CRUD scoped theo `roomId`, cùng khuôn `RoomService`. */
@Injectable()
export class ExamStationService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly roomRepository: RoomRepository,
    private readonly examStationRepository: ExamStationRepository,
  ) {}

  async createExamStation(tenantId: string, actorId: string, dto: CreateExamStationRequest, meta: RequestMeta): Promise<ExamStationSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const room = await this.roomRepository.findById(tx, tenantId, dto.roomId);
      if (!room) {
        throw new NotFoundException();
      }

      const created = await this.examStationRepository.create(tx, tenantId, actorId, { roomId: dto.roomId, name: dto.name });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'exam_station.created',
        entityType: 'exam_station',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created);
    });
  }

  async listExamStations(tenantId: string, roomId: string): Promise<ListExamStationsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.examStationRepository.listByRoom(tx, tenantId, roomId);
      return { items: rows.map((s) => this.toSummary(s)) };
    });
  }

  async updateExamStation(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateExamStationRequest,
    meta: RequestMeta,
  ): Promise<ExamStationSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.examStationRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const patch: UpdateExamStationData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const count = await this.examStationRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'exam_station.updated',
        entityType: 'exam_station',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.examStationRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  private toSummary(station: ExamStation): ExamStationSummary {
    return { id: station.id, roomId: station.roomId, name: station.name, isActive: station.isActive, version: station.version };
  }
}
