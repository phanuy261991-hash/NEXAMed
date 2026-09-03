import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ALLERGEN_CODE_PREFIX, AllergenDuplicateCodeError, AllergenGroupInvalidReferenceError, formatShortSequentialCode } from '@nexamed/core';
import type { AllergenItem, CreateAllergenRequest, ListAllergensResponse, UpdateAllergenRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { GlobalCodeSequenceRepository } from '../../infrastructure/persistence/global-code-sequence.repository';
import type { RequestMeta } from '../../common/request-meta';
import { AllergenGroupRepository } from './allergen-group.repository';
import { AllergenRepository, type AllergenWithGroupName } from './allergen.repository';

function isDuplicateCodeViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * "Dị nguyên" (docs/DECISIONS.md #069) — toàn hệ thống, luôn thuộc đúng 1 `AllergenGroup`
 * (`allergenGroupId` bắt buộc, khác `department.departmentTypeId` tuỳ chọn). Quyền:
 * `allergen_catalog.read` (mọi vai trò lâm sàng) / `allergen_catalog.manage` (chỉ `clinic_admin`).
 */
@Injectable()
export class AllergenService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly allergenRepository: AllergenRepository,
    private readonly allergenGroupRepository: AllergenGroupRepository,
    private readonly globalCodeSequenceRepository: GlobalCodeSequenceRepository,
  ) {}

  async list(tenantId: string, includeInactive: boolean): Promise<ListAllergensResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.allergenRepository.list(tx, includeInactive);
      return { items: rows.map((r) => this.toItem(r)) };
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateAllergenRequest, meta: RequestMeta): Promise<AllergenItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const group = await this.allergenGroupRepository.findById(tx, dto.allergenGroupId);
      if (!group) throw new AllergenGroupInvalidReferenceError();

      // Mã ngắn tuần tự, cấp atomic (docs/DECISIONS.md #113) — không còn cần retry trùng mã.
      const seq = await this.globalCodeSequenceRepository.next(tx, ALLERGEN_CODE_PREFIX);
      const code = formatShortSequentialCode(ALLERGEN_CODE_PREFIX, seq);
      let created: AllergenWithGroupName;
      try {
        created = await this.allergenRepository.create(tx, {
          allergenGroupId: dto.allergenGroupId,
          code,
          name: dto.name,
        });
      } catch (err) {
        if (isDuplicateCodeViolation(err)) throw new AllergenDuplicateCodeError();
        throw err;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'allergen.created',
        entityType: 'allergen',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toItem(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateAllergenRequest, meta: RequestMeta): Promise<AllergenItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.allergenRepository.findById(tx, id);
      if (!existing) throw new NotFoundException();

      if (dto.allergenGroupId !== undefined) {
        const group = await this.allergenGroupRepository.findById(tx, dto.allergenGroupId);
        if (!group) throw new AllergenGroupInvalidReferenceError();
      }

      const count = await this.allergenRepository.update(tx, id, {
        allergenGroupId: dto.allergenGroupId,
        name: dto.name,
        isActive: dto.isActive,
      });
      if (count === 0) throw new NotFoundException();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'allergen.updated',
        entityType: 'allergen',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.allergenRepository.findById(tx, id);
      if (!updated) throw new NotFoundException();
      return this.toItem(updated);
    });
  }

  async setActive(tenantId: string, actorId: string, id: string, isActive: boolean, meta: RequestMeta): Promise<AllergenItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.allergenRepository.findById(tx, id);
      if (!existing) throw new NotFoundException();

      const count = await this.allergenRepository.setActive(tx, id, isActive);
      if (count === 0) throw new NotFoundException();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: isActive ? 'allergen.reactivated' : 'allergen.deactivated',
        entityType: 'allergen',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.allergenRepository.findById(tx, id);
      if (!updated) throw new NotFoundException();
      return this.toItem(updated);
    });
  }

  private toItem(row: AllergenWithGroupName): AllergenItem {
    return {
      id: row.id,
      allergenGroupId: row.allergenGroupId,
      allergenGroupName: row.allergenGroup.name,
      code: row.code,
      name: row.name,
      isActive: row.isActive,
    };
  }
}
