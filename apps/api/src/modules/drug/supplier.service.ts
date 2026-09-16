import { Injectable, NotFoundException } from '@nestjs/common';
import { ConcurrentModificationError, formatShortSequentialCode } from '@nexamed/core';
import type { CreateSupplierRequest, ListSuppliersResponse, SupplierSummary, UpdateSupplierRequest } from '@nexamed/shared';
import type { Supplier } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import type { RequestMeta } from '../../common/request-meta';
import { SupplierRepository, type UpdateSupplierData } from './supplier.repository';

/** Mã ngắn tuần tự (docs/DECISIONS.md #113/#146) — RIÊNG theo tenant, đúng khuôn `WorkShiftService`. */
const SUPPLIER_CODE_PREFIX = 'NCC';

/** Nhà cung cấp (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — module `drug`, gate bằng
 * `drug.read`/`drug.create`/`drug.update` (tách từ `drug.manage` gộp cũ, #156). */
@Injectable()
export class SupplierService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly supplierRepository: SupplierRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
  ) {}

  async create(tenantId: string, actorId: string, dto: CreateSupplierRequest, meta: RequestMeta): Promise<SupplierSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const seq = await this.codeSequenceRepository.next(tx, tenantId, SUPPLIER_CODE_PREFIX, actorId);
      const code = formatShortSequentialCode(SUPPLIER_CODE_PREFIX, seq);
      const created = await this.supplierRepository.create(tx, tenantId, actorId, {
        code,
        name: dto.name,
        taxCode: dto.taxCode ?? null,
        phone: dto.phone ?? null,
        address: dto.address ?? null,
        contactName: dto.contactName ?? null,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'supplier.created',
        entityType: 'supplier',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created);
    });
  }

  async list(tenantId: string, includeInactive: boolean): Promise<ListSuppliersResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.supplierRepository.list(tx, tenantId, includeInactive);
      return { items: rows.map((r) => this.toSummary(r)) };
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateSupplierRequest, meta: RequestMeta): Promise<SupplierSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.supplierRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const patch: UpdateSupplierData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.taxCode !== undefined) patch.taxCode = dto.taxCode;
      if (dto.phone !== undefined) patch.phone = dto.phone;
      if (dto.address !== undefined) patch.address = dto.address;
      if (dto.contactName !== undefined) patch.contactName = dto.contactName;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const count = await this.supplierRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'supplier.updated',
        entityType: 'supplier',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.supplierRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  private toSummary(supplier: Supplier): SupplierSummary {
    return {
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      taxCode: supplier.taxCode,
      phone: supplier.phone,
      address: supplier.address,
      contactName: supplier.contactName,
      isActive: supplier.isActive,
      version: supplier.version,
    };
  }
}
