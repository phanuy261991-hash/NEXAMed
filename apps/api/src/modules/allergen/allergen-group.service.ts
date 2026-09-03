import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AllergenGroup } from '@prisma/client';
import { ALLERGEN_GROUP_CODE_PREFIX, AllergenGroupDuplicateCodeError, formatShortSequentialCode } from '@nexamed/core';
import type {
  AllergenGroupSummary,
  CreateAllergenGroupRequest,
  ListAllergenGroupsResponse,
  UpdateAllergenGroupRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { GlobalCodeSequenceRepository } from '../../infrastructure/persistence/global-code-sequence.repository';
import type { RequestMeta } from '../../common/request-meta';
import { AllergenGroupRepository } from './allergen-group.repository';

function isDuplicateCodeViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * "Nhóm dị nguyên" (docs/DECISIONS.md #069) — toàn hệ thống, không tenant_id trên bảng nhưng
 * `writeAuditLog` vẫn cần `tenantId`/`actorId` của người thao tác (audit luôn gắn theo tenant của
 * actor, đúng khuôn `ReferenceCatalogService`). Quyền: `allergen_catalog.read` (mọi vai trò lâm
 * sàng) / `allergen_catalog.manage` (chỉ `clinic_admin`).
 */
@Injectable()
export class AllergenGroupService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly allergenGroupRepository: AllergenGroupRepository,
    private readonly globalCodeSequenceRepository: GlobalCodeSequenceRepository,
  ) {}

  async list(tenantId: string, includeInactive: boolean): Promise<ListAllergenGroupsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.allergenGroupRepository.list(tx, includeInactive);
      return { items: rows.map((r) => this.toSummary(r)) };
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateAllergenGroupRequest, meta: RequestMeta): Promise<AllergenGroupSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      // Mã ngắn tuần tự, cấp atomic (docs/DECISIONS.md #113) — không còn cần retry trùng mã như
      // cơ chế ngẫu nhiên cũ.
      const seq = await this.globalCodeSequenceRepository.next(tx, ALLERGEN_GROUP_CODE_PREFIX);
      const code = formatShortSequentialCode(ALLERGEN_GROUP_CODE_PREFIX, seq);
      let created: AllergenGroup;
      try {
        created = await this.allergenGroupRepository.create(tx, { code, name: dto.name });
      } catch (err) {
        if (isDuplicateCodeViolation(err)) throw new AllergenGroupDuplicateCodeError();
        throw err;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'allergen_group.created',
        entityType: 'allergen_group',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateAllergenGroupRequest, meta: RequestMeta): Promise<AllergenGroupSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.allergenGroupRepository.findById(tx, id);
      if (!existing) throw new NotFoundException();

      const count = await this.allergenGroupRepository.update(tx, id, { name: dto.name, isActive: dto.isActive });
      if (count === 0) throw new NotFoundException();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'allergen_group.updated',
        entityType: 'allergen_group',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.allergenGroupRepository.findById(tx, id);
      if (!updated) throw new NotFoundException();
      return this.toSummary(updated);
    });
  }

  async setActive(tenantId: string, actorId: string, id: string, isActive: boolean, meta: RequestMeta): Promise<AllergenGroupSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.allergenGroupRepository.findById(tx, id);
      if (!existing) throw new NotFoundException();

      const count = await this.allergenGroupRepository.setActive(tx, id, isActive);
      if (count === 0) throw new NotFoundException();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: isActive ? 'allergen_group.reactivated' : 'allergen_group.deactivated',
        entityType: 'allergen_group',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.allergenGroupRepository.findById(tx, id);
      if (!updated) throw new NotFoundException();
      return this.toSummary(updated);
    });
  }

  private toSummary(row: AllergenGroup): AllergenGroupSummary {
    return { id: row.id, code: row.code, name: row.name, isActive: row.isActive };
  }
}
