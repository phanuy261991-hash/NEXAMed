import { Injectable, NotFoundException } from '@nestjs/common';
import { ConcurrentModificationError, formatShortSequentialCode } from '@nexamed/core';
import type { CreateWarehouseRequest, ListWarehousesResponse, UpdateWarehouseRequest, WarehouseSummary } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import type { RequestMeta } from '../../common/request-meta';
import { WarehouseRepository, type UpdateWarehouseData, type WarehouseWithDepartment } from './warehouse.repository';

/** Mã ngắn tuần tự (docs/DECISIONS.md #113/#146) — RIÊNG theo tenant, đúng khuôn `WorkShiftService`. */
const WAREHOUSE_CODE_PREFIX = 'KH';

/** Kho (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — module `drug`, dùng chung `drug.read`/
 * `drug.manage`. Seed 1 kho mặc định lúc tạo tenant (`ensureDefaultWarehouse`, đúng khuôn `floor`/
 * `room` #054/#055) — web tự ẩn UI khi tenant chỉ có 1 kho. */
@Injectable()
export class WarehouseService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly warehouseRepository: WarehouseRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
  ) {}

  async createWarehouse(tenantId: string, actorId: string, dto: CreateWarehouseRequest, meta: RequestMeta): Promise<WarehouseSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      if (dto.isDefault) {
        await this.warehouseRepository.clearDefaultExcept(tx, tenantId, null, actorId);
      }
      const seq = await this.codeSequenceRepository.next(tx, tenantId, WAREHOUSE_CODE_PREFIX, actorId);
      const code = formatShortSequentialCode(WAREHOUSE_CODE_PREFIX, seq);
      const created = await this.warehouseRepository.create(tx, tenantId, actorId, {
        code,
        name: dto.name,
        departmentId: dto.departmentId ?? null,
        isDefault: dto.isDefault ?? false,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'warehouse.created',
        entityType: 'warehouse',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const withDepartment = await this.warehouseRepository.findById(tx, tenantId, created.id);
      return this.toSummary(withDepartment!);
    });
  }

  async listWarehouses(tenantId: string): Promise<ListWarehousesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.warehouseRepository.list(tx, tenantId);
      return { items: rows.map((r) => this.toSummary(r)) };
    });
  }

  async updateWarehouse(tenantId: string, actorId: string, id: string, dto: UpdateWarehouseRequest, meta: RequestMeta): Promise<WarehouseSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.warehouseRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      if (dto.isDefault) {
        await this.warehouseRepository.clearDefaultExcept(tx, tenantId, id, actorId);
      }

      const patch: UpdateWarehouseData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.departmentId !== undefined) patch.departmentId = dto.departmentId;
      if (dto.isDefault !== undefined) patch.isDefault = dto.isDefault;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const count = await this.warehouseRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'warehouse.updated',
        entityType: 'warehouse',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.warehouseRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  private toSummary(warehouse: WarehouseWithDepartment): WarehouseSummary {
    return {
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      departmentId: warehouse.departmentId,
      departmentName: warehouse.department?.name ?? null,
      isDefault: warehouse.isDefault,
      isActive: warehouse.isActive,
      version: warehouse.version,
    };
  }
}
