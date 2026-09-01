import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type WorkShift } from '@prisma/client';
import {
  ConcurrentModificationError,
  WorkShiftDuplicateCodeError,
  WorkShiftInvalidTimeRangeError,
  generateReferenceCatalogCode,
} from '@nexamed/core';
import type { CreateWorkShiftRequest, ListWorkShiftsResponse, UpdateWorkShiftRequest, WorkShiftItem } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { WorkShiftRepository, type UpdateWorkShiftData } from './work-shift.repository';

function isDuplicateCodeViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Random hex nên xác suất trùng cực nhỏ — vài lần thử là đủ, cùng khuôn `ReferenceCatalogService`. */
const AUTO_CODE_MAX_ATTEMPTS = 5;

/** "HH:mm" → phút trong ngày, chỉ để so sánh thứ tự — không cần xử lý múi giờ (cùng bản chất
 * `DayHours.open/close`, không phải mốc thời gian thật). */
function toMinutes(hhmm: string): number {
  const parts = hhmm.split(':');
  return Number(parts[0] ?? 0) * 60 + Number(parts[1] ?? 0);
}

/**
 * "Ca làm việc" (docs/DECISIONS.md #101) — danh mục mẫu ca RIÊNG theo tenant, module `clinic`
 * (.claude/docs/architecture.md). Quyền `clinic_config.read`/`.update`, đúng khuôn `RoomService`
 * (không permission mới).
 */
@Injectable()
export class WorkShiftService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly workShiftRepository: WorkShiftRepository,
  ) {}

  private assertValidTimeRange(input: {
    startTime: string;
    endTime: string;
    restStartTime?: string | null;
    restEndTime?: string | null;
  }): void {
    const start = toMinutes(input.startTime);
    const end = toMinutes(input.endTime);
    if (end <= start) {
      throw new WorkShiftInvalidTimeRangeError('Giờ kết thúc phải sau giờ bắt đầu.');
    }
    if (input.restStartTime != null && input.restEndTime != null) {
      const restStart = toMinutes(input.restStartTime);
      const restEnd = toMinutes(input.restEndTime);
      if (restEnd <= restStart) {
        throw new WorkShiftInvalidTimeRangeError('Kết thúc giờ nghỉ phải sau bắt đầu giờ nghỉ.');
      }
      if (restStart < start || restEnd > end) {
        throw new WorkShiftInvalidTimeRangeError('Giờ nghỉ phải nằm trong khoảng giờ làm việc của ca.');
      }
    }
  }

  async create(tenantId: string, actorId: string, dto: CreateWorkShiftRequest, meta: RequestMeta): Promise<WorkShiftItem> {
    this.assertValidTimeRange(dto);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let created: WorkShift | undefined;
      for (let attempt = 1; attempt <= AUTO_CODE_MAX_ATTEMPTS; attempt++) {
        const code = generateReferenceCatalogCode('work_shift');
        try {
          created = await this.workShiftRepository.create(tx, tenantId, actorId, {
            name: dto.name,
            code,
            startTime: dto.startTime,
            endTime: dto.endTime,
            color: dto.color,
            restStartTime: dto.restStartTime ?? null,
            restEndTime: dto.restEndTime ?? null,
            restMinutes: dto.restMinutes ?? null,
            standardWorkMinutes: dto.standardWorkMinutes ?? null,
            sortOrder: dto.sortOrder,
          });
          break;
        } catch (err) {
          if (!isDuplicateCodeViolation(err) || attempt === AUTO_CODE_MAX_ATTEMPTS) {
            if (isDuplicateCodeViolation(err)) throw new WorkShiftDuplicateCodeError();
            throw err;
          }
          // Mã tự sinh trùng — vòng lặp tự sinh mã khác rồi thử lại.
        }
      }
      if (!created) {
        throw new WorkShiftDuplicateCodeError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'work_shift.created',
        entityType: 'work_shift',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toItem(created);
    });
  }

  async list(tenantId: string): Promise<ListWorkShiftsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.workShiftRepository.list(tx, tenantId);
      return { items: rows.map((r) => this.toItem(r)) };
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateWorkShiftRequest, meta: RequestMeta): Promise<WorkShiftItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.workShiftRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      this.assertValidTimeRange({
        startTime: dto.startTime ?? existing.startTime,
        endTime: dto.endTime ?? existing.endTime,
        restStartTime: dto.restStartTime !== undefined ? dto.restStartTime : existing.restStartTime,
        restEndTime: dto.restEndTime !== undefined ? dto.restEndTime : existing.restEndTime,
      });

      const patch: UpdateWorkShiftData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.startTime !== undefined) patch.startTime = dto.startTime;
      if (dto.endTime !== undefined) patch.endTime = dto.endTime;
      if (dto.color !== undefined) patch.color = dto.color;
      if (dto.restStartTime !== undefined) patch.restStartTime = dto.restStartTime;
      if (dto.restEndTime !== undefined) patch.restEndTime = dto.restEndTime;
      if (dto.restMinutes !== undefined) patch.restMinutes = dto.restMinutes;
      if (dto.standardWorkMinutes !== undefined) patch.standardWorkMinutes = dto.standardWorkMinutes;
      if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const count = await this.workShiftRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'work_shift.updated',
        entityType: 'work_shift',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.workShiftRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toItem(updated);
    });
  }

  private toItem(row: WorkShift): WorkShiftItem {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      startTime: row.startTime,
      endTime: row.endTime,
      color: row.color as WorkShiftItem['color'],
      restStartTime: row.restStartTime,
      restEndTime: row.restEndTime,
      restMinutes: row.restMinutes,
      standardWorkMinutes: row.standardWorkMinutes,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      version: row.version,
    };
  }
}
