import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ReferenceCatalog } from '@prisma/client';
import { ReferenceCatalogDuplicateCodeError } from '@nexamed/core';
import type {
  CreateReferenceCatalogRequest,
  ListReferenceCatalogResponse,
  ReferenceCatalogCategory,
  ReferenceCatalogItem,
  UpdateReferenceCatalogRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { ReferenceCatalogRepository } from './reference-catalog.repository';

function isDuplicateCodeViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Danh mục dùng chung toàn hệ thống (Dân tộc, Quốc tịch — docs/DECISIONS.md, đảo ngược #034
 * phần ethnicity/nationality). Không tenant_id trên `reference_catalog` nhưng `writeAuditLog`
 * vẫn cần `tenantId`/`actorId` của người thao tác — audit luôn gắn theo tenant của actor, đúng
 * khuôn `writeAuditLog` dùng ở mọi service khác. Quyền: `reference_catalog.read` (mọi vai trò
 * lâm sàng) / `reference_catalog.manage` (chỉ `clinic_admin`) — xem .claude/docs/security-audit.md.
 */
@Injectable()
export class ReferenceCatalogService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
  ) {}

  async listByCategory(
    tenantId: string,
    category: ReferenceCatalogCategory,
    includeInactive: boolean,
  ): Promise<ListReferenceCatalogResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.referenceCatalogRepository.listByCategory(tx, category, includeInactive);
      return { items: rows.map((r) => this.toItem(r)) };
    });
  }

  async create(
    tenantId: string,
    actorId: string,
    dto: CreateReferenceCatalogRequest,
    meta: RequestMeta,
  ): Promise<ReferenceCatalogItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let created: ReferenceCatalog;
      try {
        created = await this.referenceCatalogRepository.create(tx, {
          category: dto.category,
          code: dto.code,
          name: dto.name,
          sortOrder: dto.sortOrder,
        });
      } catch (err) {
        if (isDuplicateCodeViolation(err)) {
          throw new ReferenceCatalogDuplicateCodeError();
        }
        throw err;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'reference_catalog.created',
        entityType: 'reference_catalog',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toItem(created);
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateReferenceCatalogRequest,
    meta: RequestMeta,
  ): Promise<ReferenceCatalogItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.referenceCatalogRepository.findById(tx, id);
      if (!existing) {
        throw new NotFoundException();
      }

      let count: number;
      try {
        count = await this.referenceCatalogRepository.update(tx, id, {
          code: dto.code,
          name: dto.name,
          sortOrder: dto.sortOrder,
        });
      } catch (err) {
        if (isDuplicateCodeViolation(err)) {
          throw new ReferenceCatalogDuplicateCodeError();
        }
        throw err;
      }
      if (count === 0) {
        throw new NotFoundException();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'reference_catalog.updated',
        entityType: 'reference_catalog',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.referenceCatalogRepository.findById(tx, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toItem(updated);
    });
  }

  async setActive(
    tenantId: string,
    actorId: string,
    id: string,
    isActive: boolean,
    meta: RequestMeta,
  ): Promise<ReferenceCatalogItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.referenceCatalogRepository.findById(tx, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const count = await this.referenceCatalogRepository.setActive(tx, id, isActive);
      if (count === 0) {
        throw new NotFoundException();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: isActive ? 'reference_catalog.reactivated' : 'reference_catalog.deactivated',
        entityType: 'reference_catalog',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.referenceCatalogRepository.findById(tx, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toItem(updated);
    });
  }

  private toItem(row: ReferenceCatalog): ReferenceCatalogItem {
    return {
      id: row.id,
      category: row.category,
      code: row.code,
      name: row.name,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
    };
  }
}
