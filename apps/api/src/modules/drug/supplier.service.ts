import { Injectable, NotFoundException } from '@nestjs/common';
import { ConcurrentModificationError, formatShortSequentialCode } from '@nexamed/core';
import type { CreateSupplierRequest, ListSuppliersResponse, SupplierSummary, UpdateSupplierRequest } from '@nexamed/shared';
import type { Prisma, Supplier } from '@prisma/client';
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
        afterJson: { code, name: created.name, taxCode: created.taxCode },
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

  async getById(tenantId: string, id: string): Promise<SupplierSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const row = await this.supplierRepository.findById(tx, tenantId, id);
      if (!row) {
        throw new NotFoundException();
      }
      return this.toSummary(row);
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

      // Chỉ ghi GIÁ TRỊ trước/sau của trường định danh doanh nghiệp (tên, mã số thuế, trạng thái); điện thoại/địa chỉ/người liên hệ
      // (có thể là dữ liệu cá nhân) chỉ ghi TÊN trường đã đổi, không ghi giá trị.
      const beforeJson: Record<string, Prisma.InputJsonValue | null> = {};
      const afterJson: Record<string, Prisma.InputJsonValue | null> = {};
      const changedContactFields: string[] = [];
      if (patch.name !== undefined && patch.name !== existing.name) { beforeJson.name = existing.name; afterJson.name = patch.name; }
      if (patch.taxCode !== undefined && patch.taxCode !== existing.taxCode) { beforeJson.taxCode = existing.taxCode; afterJson.taxCode = patch.taxCode; }
      if (patch.isActive !== undefined && patch.isActive !== existing.isActive) { beforeJson.isActive = existing.isActive; afterJson.isActive = patch.isActive; }
      if (patch.phone !== undefined && patch.phone !== existing.phone) changedContactFields.push('phone');
      if (patch.address !== undefined && patch.address !== existing.address) changedContactFields.push('address');
      if (patch.contactName !== undefined && patch.contactName !== existing.contactName) changedContactFields.push('contactName');
      if (changedContactFields.length > 0) afterJson.changedContactFields = changedContactFields;

      const count = await this.supplierRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'supplier.updated',
        entityType: 'supplier',
        entityId: id,
        beforeJson,
        afterJson,
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
