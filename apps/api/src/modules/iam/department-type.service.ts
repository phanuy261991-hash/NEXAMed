import { Injectable, NotFoundException } from '@nestjs/common';
import type { DepartmentType } from '@prisma/client';
import { ConcurrentModificationError } from '@nexamed/core';
import type {
  CreateDepartmentTypeRequest,
  DepartmentTypeSummary,
  ListDepartmentTypesResponse,
  UpdateDepartmentTypeRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { DepartmentTypeRepository, type UpdateDepartmentTypeData } from './department-type.repository';

/** "Loại Khoa/Phòng" (mở rộng ADM-01) — CRUD, cùng khuôn `FloorService`. */
@Injectable()
export class DepartmentTypeService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly departmentTypeRepository: DepartmentTypeRepository,
  ) {}

  async createDepartmentType(
    tenantId: string,
    actorId: string,
    dto: CreateDepartmentTypeRequest,
    meta: RequestMeta,
  ): Promise<DepartmentTypeSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const created = await this.departmentTypeRepository.create(tx, tenantId, actorId, dto.name);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'department_type.created',
        entityType: 'department_type',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created);
    });
  }

  async listDepartmentTypes(tenantId: string): Promise<ListDepartmentTypesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.departmentTypeRepository.list(tx, tenantId);
      return { items: rows.map((r) => this.toSummary(r)) };
    });
  }

  async updateDepartmentType(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateDepartmentTypeRequest,
    meta: RequestMeta,
  ): Promise<DepartmentTypeSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.departmentTypeRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const patch: UpdateDepartmentTypeData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const count = await this.departmentTypeRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'department_type.updated',
        entityType: 'department_type',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.departmentTypeRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  private toSummary(departmentType: DepartmentType): DepartmentTypeSummary {
    return { id: departmentType.id, name: departmentType.name, isActive: departmentType.isActive, version: departmentType.version };
  }
}