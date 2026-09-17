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
          // Cột cũ (S4-03) — không còn ghi từ form mới (mở rộng #151 chuyển sang manufacturerCode),
          // vẫn nhận nếu client gửi (tương thích ngược, ví dụ script/API cũ).
          manufacturer: dto.manufacturer ?? null,
          // Bắt buộc cho CẢ 2 loại — KHÔNG ép theo itemType (khác 8 field MEDICINE-only dưới đây).
          manufacturerCode: dto.manufacturerCode,
          minStockAlert: dto.minStockAlert ?? null,
          maxStockAlert: dto.maxStockAlert ?? null,
          // CHỈ có ý nghĩa với MEDICINE — ép giá trị trung tính cho SUPPLY dù Zod có default an toàn,
          // tránh phụ thuộc vào việc frontend luôn ẩn field đúng (docs/DECISIONS.md #151).
          controlType: dto.itemType === 'MEDICINE' ? dto.controlType : 'NORMAL',
          isPrescriptionOnly: dto.itemType === 'MEDICINE' ? dto.isPrescriptionOnly : true,
          registrationNumber: dto.itemType === 'MEDICINE' ? (dto.registrationNumber ?? null) : null,
          dosageForm: dto.itemType === 'MEDICINE' ? (dto.dosageForm ?? null) : null,
          countryOfOrigin: dto.itemType === 'MEDICINE' ? (dto.countryOfOrigin ?? null) : null,
          defaultDosage: dto.itemType === 'MEDICINE' ? (dto.defaultDosage ?? null) : null,
          usageInstruction: dto.itemType === 'MEDICINE' ? (dto.usageInstruction ?? null) : null,
          contraindications: dto.itemType === 'MEDICINE' ? (dto.contraindications ?? null) : null,
          storageConditions: dto.itemType === 'MEDICINE' ? (dto.storageConditions ?? null) : null,
          storageLocation: dto.itemType === 'MEDICINE' ? (dto.storageLocation ?? null) : null,
          barcode: dto.itemType === 'MEDICINE' ? (dto.barcode ?? null) : null,
          // "Quy cách đóng gói" — KHÔNG giới hạn MEDICINE như nhóm trường trên (đảo ngược hoãn #151):
          // vật tư y tế cũng đóng gói theo hộp/gói/thùng như thuốc, cùng phạm vi với Bảng quy đổi
          // đơn vị (`units`) vốn cũng không giới hạn itemType.
          packagingSpec: dto.packagingSpec ?? null,
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
      const rows = await this.drugRepository.list(tx, tenantId, {
        q: query.q,
        itemType: query.itemType,
        includeInactive: query.includeInactive,
        prescriptionOnly: query.prescriptionOnly,
      });
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
          manufacturerCode: dto.manufacturerCode,
          minStockAlert: dto.minStockAlert,
          maxStockAlert: dto.maxStockAlert,
          // undefined = không đổi (đúng khuôn mọi field optional khác) — CHỈ có ý nghĩa với MEDICINE,
          // frontend ẩn field cho SUPPLY nên không gửi lên; create() đã ép NORMAL/true khi tạo SUPPLY.
          controlType: dto.controlType,
          isPrescriptionOnly: dto.isPrescriptionOnly,
          registrationNumber: dto.registrationNumber,
          dosageForm: dto.dosageForm,
          countryOfOrigin: dto.countryOfOrigin,
          defaultDosage: dto.defaultDosage,
          usageInstruction: dto.usageInstruction,
          contraindications: dto.contraindications,
          storageConditions: dto.storageConditions,
          storageLocation: dto.storageLocation,
          barcode: dto.barcode,
          packagingSpec: dto.packagingSpec,
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
      manufacturerCode: drug.manufacturerCode,
      minStockAlert: drug.minStockAlert,
      maxStockAlert: drug.maxStockAlert,
      controlType: drug.controlType,
      isPrescriptionOnly: drug.isPrescriptionOnly,
      registrationNumber: drug.registrationNumber,
      dosageForm: drug.dosageForm,
      countryOfOrigin: drug.countryOfOrigin,
      defaultDosage: drug.defaultDosage,
      usageInstruction: drug.usageInstruction,
      contraindications: drug.contraindications,
      storageConditions: drug.storageConditions,
      storageLocation: drug.storageLocation,
      barcode: drug.barcode,
      packagingSpec: drug.packagingSpec,
      lastPurchaseUnitCost: drug.lastPurchaseUnitCost === null ? null : Number(drug.lastPurchaseUnitCost),
      lastPurchaseAt: drug.lastPurchaseAt?.toISOString() ?? null,
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
