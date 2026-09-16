import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConcurrentModificationError, DrugDuplicateCodeError } from '@nexamed/core';
import type { CreateDrugRequest, DrugSummary, ListDrugsQuery, ListDrugsResponse, UpdateDrugRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { DrugRepository, type DrugWithDetails } from './drug.repository';
import { DrugIngredientRepository } from './drug-ingredient.repository';
import { DrugUnitRepository } from './drug-unit.repository';

function isDuplicateCodeViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Danh mục Thuốc & Vật tư y tế (Sprint 4, S4-03; mở rộng Giai đoạn 1 của Kho Thuốc & Vật tư y tế —
 * docs/DECISIONS.md #146) — THEO TENANT, phòng khám tự nhập. GĐ1 vẫn CHỈ danh mục (không tồn kho,
 * xem comment ở packages/shared/src/drug.ts).
 */
@Injectable()
export class DrugService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly drugRepository: DrugRepository,
    private readonly drugIngredientRepository: DrugIngredientRepository,
    private readonly drugUnitRepository: DrugUnitRepository,
  ) {}

  async create(tenantId: string, actorId: string, dto: CreateDrugRequest, meta: RequestMeta): Promise<DrugSummary> {
    // Vật tư y tế KHÔNG có hoạt chất/hàm lượng (yêu cầu chủ dự án) — Zod không biết được itemType
    // trước khi validate xong nên kiểm ở đây, không ở packages/shared.
    if (dto.itemType === 'SUPPLY' && dto.ingredients.length > 0) {
      throw new BadRequestException('Vật tư y tế không có hoạt chất/hàm lượng.');
    }

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let created;
      try {
        created = await this.drugRepository.create(tx, tenantId, actorId, {
          code: dto.code,
          name: dto.name,
          itemType: dto.itemType,
          isBatchManaged: dto.isBatchManaged,
          baseUnitCode: dto.baseUnitCode,
          defaultSellPrice: dto.defaultSellPrice !== undefined ? BigInt(dto.defaultSellPrice) : null,
          unitPricingEnabled: dto.unitPricingEnabled,
          drugGroupCode: dto.drugGroupCode ?? null,
          routeCode: dto.routeCode ?? null,
          nationalCode: dto.nationalCode ?? null,
          manufacturer: dto.manufacturer ?? null,
          minStockAlert: dto.minStockAlert ?? null,
          maxStockAlert: dto.maxStockAlert ?? null,
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

      await this.drugIngredientRepository.replaceForDrug(tx, tenantId, created.id, actorId, dto.ingredients);
      await this.drugUnitRepository.replaceForDrug(tx, tenantId, created.id, actorId, dto.units);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'drug.created',
        entityType: 'drug',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const withDetails = await this.drugRepository.findByIdWithDetails(tx, tenantId, created.id);
      return this.toSummary(withDetails!);
    });
  }

  async list(tenantId: string, query: ListDrugsQuery): Promise<ListDrugsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.drugRepository.list(tx, tenantId, { q: query.q, itemType: query.itemType, includeInactive: query.includeInactive });
      return { items: rows.map((r) => this.toSummary(r)) };
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateDrugRequest, meta: RequestMeta): Promise<DrugSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.drugRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const nextItemType = dto.itemType ?? existing.itemType;
      const nextIngredients = dto.ingredients ?? null;
      if (nextItemType === 'SUPPLY' && nextIngredients && nextIngredients.length > 0) {
        throw new BadRequestException('Vật tư y tế không có hoạt chất/hàm lượng.');
      }

      let count: number;
      try {
        count = await this.drugRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, {
          code: dto.code,
          name: dto.name,
          itemType: dto.itemType,
          isBatchManaged: dto.isBatchManaged,
          baseUnitCode: dto.baseUnitCode,
          defaultSellPrice: dto.defaultSellPrice === undefined ? undefined : dto.defaultSellPrice === null ? null : BigInt(dto.defaultSellPrice),
          unitPricingEnabled: dto.unitPricingEnabled,
          drugGroupCode: dto.drugGroupCode,
          routeCode: dto.routeCode,
          nationalCode: dto.nationalCode,
          manufacturer: dto.manufacturer,
          minStockAlert: dto.minStockAlert,
          maxStockAlert: dto.maxStockAlert,
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

      if (dto.ingredients !== undefined) {
        await this.drugIngredientRepository.replaceForDrug(tx, tenantId, id, actorId, dto.ingredients);
      }
      if (dto.units !== undefined) {
        await this.drugUnitRepository.replaceForDrug(tx, tenantId, id, actorId, dto.units);
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'drug.updated',
        entityType: 'drug',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.drugRepository.findByIdWithDetails(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  private toSummary(drug: DrugWithDetails): DrugSummary {
    return {
      id: drug.id,
      code: drug.code,
      name: drug.name,
      itemType: drug.itemType,
      isBatchManaged: drug.isBatchManaged,
      baseUnitCode: drug.baseUnitCode,
      defaultSellPrice: drug.defaultSellPrice === null ? null : Number(drug.defaultSellPrice),
      unitPricingEnabled: drug.unitPricingEnabled,
      drugGroupCode: drug.drugGroupCode,
      routeCode: drug.routeCode,
      nationalCode: drug.nationalCode,
      manufacturer: drug.manufacturer,
      minStockAlert: drug.minStockAlert,
      maxStockAlert: drug.maxStockAlert,
      ingredients: drug.ingredients,
      units: drug.units.map((u) => ({ ...u, sellPrice: u.sellPrice === null ? null : Number(u.sellPrice) })),
      activeIngredient: drug.activeIngredient,
      unit: drug.unit,
      concentration: drug.concentration,
      isActive: drug.isActive,
      version: drug.version,
    };
  }
}
