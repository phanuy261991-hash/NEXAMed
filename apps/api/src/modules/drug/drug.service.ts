import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Drug } from '@prisma/client';
import { ConcurrentModificationError, DrugDuplicateCodeError } from '@nexamed/core';
import type { CreateDrugRequest, DrugSummary, ListDrugsQuery, ListDrugsResponse, UpdateDrugRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { DrugRepository } from './drug.repository';

function isDuplicateCodeViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Danh mục thuốc (Sprint 4, S4-03) — THEO TENANT, phòng khám tự nhập (PRD mục 8). Chỉ "Trường hợp
 * A" đã chốt: ghi nhận + tìm kiếm để kê đơn, KHÔNG tồn kho/giá bán (docs/DECISIONS.md 2026-08-25).
 */
@Injectable()
export class DrugService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly drugRepository: DrugRepository,
  ) {}

  async create(tenantId: string, actorId: string, dto: CreateDrugRequest, meta: RequestMeta): Promise<DrugSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let created: Drug;
      try {
        created = await this.drugRepository.create(tx, tenantId, actorId, {
          code: dto.code,
          name: dto.name,
          activeIngredient: dto.activeIngredient ?? null,
          unit: dto.unit ?? null,
          concentration: dto.concentration ?? null,
        });
      } catch (err) {
        if (isDuplicateCodeViolation(err)) {
          throw new DrugDuplicateCodeError();
        }
        throw err;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'drug.created',
        entityType: 'drug',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created);
    });
  }

  async list(tenantId: string, query: ListDrugsQuery): Promise<ListDrugsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.drugRepository.list(tx, tenantId, { q: query.q, includeInactive: query.includeInactive });
      return { items: rows.map((r) => this.toSummary(r)) };
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateDrugRequest, meta: RequestMeta): Promise<DrugSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.drugRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      let count: number;
      try {
        count = await this.drugRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, {
          code: dto.code,
          name: dto.name,
          activeIngredient: dto.activeIngredient,
          unit: dto.unit,
          concentration: dto.concentration,
          isActive: dto.isActive,
        });
      } catch (err) {
        if (isDuplicateCodeViolation(err)) {
          throw new DrugDuplicateCodeError();
        }
        throw err;
      }
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'drug.updated',
        entityType: 'drug',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.drugRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  private toSummary(drug: Drug): DrugSummary {
    return {
      id: drug.id,
      code: drug.code,
      name: drug.name,
      activeIngredient: drug.activeIngredient,
      unit: drug.unit,
      concentration: drug.concentration,
      isActive: drug.isActive,
      version: drug.version,
    };
  }
}
