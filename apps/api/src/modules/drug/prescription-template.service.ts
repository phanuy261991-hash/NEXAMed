import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConcurrentModificationError } from '@nexamed/core';
import { resolvePrescriptionItemDose } from '@nexamed/shared';
import type { Drug } from '@prisma/client';
import type {
  CreatePrescriptionTemplateRequest,
  ListPrescriptionTemplatesResponse,
  PrescriptionTemplate as PrescriptionTemplateDto,
  UpdatePrescriptionTemplateRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { DrugRepository } from './drug.repository';
import { PrescriptionTemplateRepository, type PrescriptionTemplateWithItems } from './prescription-template.repository';

/**
 * "Đơn thuốc mẫu" (Kho Thuốc GĐ5) — CRUD đơn giản, dùng CHUNG toàn tenant (không tách theo bác sĩ,
 * xem packages/shared/src/prescription-template.ts). Thuộc module `drug` (đúng
 * .claude/docs/architecture.md: GĐ5 mở rộng module `drug`) — dùng chung `DrugRepository` đã có
 * trong cùng module để validate `drugId` tồn tại, không cần import module nào khác.
 */
@Injectable()
export class PrescriptionTemplateService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly templateRepository: PrescriptionTemplateRepository,
    private readonly drugRepository: DrugRepository,
  ) {}

  async list(tenantId: string, includeInactive = false): Promise<ListPrescriptionTemplatesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.templateRepository.list(tx, tenantId, includeInactive);
      return { items: rows.map((r) => this.toDto(r)) };
    });
  }

  async create(tenantId: string, actorId: string, dto: CreatePrescriptionTemplateRequest, meta: RequestMeta): Promise<PrescriptionTemplateDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const drugs = await this.assertDrugsExist(tx, tenantId, dto.items.map((i) => i.drugId));

      const created = await this.templateRepository.create(tx, tenantId, actorId, dto.name);
      await this.templateRepository.replaceItems(tx, tenantId, created.id, actorId, dto.items.map((i) => this.toItemData(i, drugs)));

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription_template.created',
        entityType: 'prescription_template',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const withItems = await this.templateRepository.findById(tx, tenantId, created.id);
      return this.toDto(withItems!);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdatePrescriptionTemplateRequest, meta: RequestMeta): Promise<PrescriptionTemplateDto> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.templateRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }
      const drugs = dto.items !== undefined ? await this.assertDrugsExist(tx, tenantId, dto.items.map((i) => i.drugId)) : new Map<string, Drug>();

      const count = await this.templateRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, {
        name: dto.name,
        isActive: dto.isActive,
      });
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      if (dto.items !== undefined) {
        await this.templateRepository.replaceItems(tx, tenantId, id, actorId, dto.items.map((i) => this.toItemData(i, drugs)));
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'prescription_template.updated',
        entityType: 'prescription_template',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.templateRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toDto(updated);
    });
  }

  private async assertDrugsExist(tx: Parameters<DrugRepository['findByIds']>[0], tenantId: string, drugIds: string[]): Promise<Map<string, Drug>> {
    const uniqueIds = [...new Set(drugIds)];
    const found = await this.drugRepository.findByIds(tx, tenantId, uniqueIds);
    if (found.length !== uniqueIds.length) {
      throw new BadRequestException('Có thuốc trong mẫu không tồn tại trong danh mục.');
    }
    return new Map(found.map((d) => [d.id, d]));
  }

  /** `quantity` LUÔN do backend tính (docs/DECISIONS.md #196), đúng khuôn `EncounterService.
   * toCreateItemData()`. */
  private toItemData(item: CreatePrescriptionTemplateRequest['items'][number], drugs: Map<string, Drug>) {
    const drug = drugs.get(item.drugId);
    // Đơn mẫu không lưu tên đơn vị liều: chỉ cần biết thuốc CÓ đơn vị liều hay không (quyết kiểu kê cố định + dung tích để tính số lượng), nên mã đủ dùng.
    const dose = resolvePrescriptionItemDose(item, drug ? { doseMode: drug.doseMode, doseUnitName: drug.doseUnitCode, dosePerBaseUnit: drug.dosePerBaseUnit === null ? null : Number(drug.dosePerBaseUnit) } : null);
    if (dose.doseMode === 'SCHEDULED' && dose.durationDays === null) {
      throw new BadRequestException('Thuốc này kê theo buổi nên cần nhập số ngày dùng.');
    }
    return {
      drugId: item.drugId,
      doseMorning: dose.doseMorning,
      doseNoon: dose.doseNoon,
      doseAfternoon: dose.doseAfternoon,
      doseEvening: dose.doseEvening,
      durationDays: dose.durationDays,
      doseMode: dose.doseMode,
      singleDose: dose.singleDose,
      quantity: dose.quantity,
      instruction: item.instruction ?? null,
    };
  }

  private toDto(row: PrescriptionTemplateWithItems): PrescriptionTemplateDto {
    return {
      id: row.id,
      name: row.name,
      items: row.items.map((item) => ({
        id: item.id,
        drugId: item.drugId,
        drugName: item.drugName,
        doseMorning: item.doseMorning,
        doseNoon: item.doseNoon,
        doseAfternoon: item.doseAfternoon,
        doseEvening: item.doseEvening,
        durationDays: item.durationDays,
        doseMode: item.doseMode,
        singleDose: item.singleDose,
        quantity: item.quantity,
        unitCode: item.unitCode,
        instruction: item.instruction ?? undefined,
      })),
      isActive: row.isActive,
      version: row.version,
    };
  }
}
