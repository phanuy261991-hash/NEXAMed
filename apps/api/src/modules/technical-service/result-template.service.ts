import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ResultTemplate } from '@prisma/client';
import { ConcurrentModificationError } from '@nexamed/core';
import type {
  CreateResultTemplateRequest,
  ListResultTemplatesQuery,
  ListResultTemplatesResponse,
  ResultTemplateItem,
  UpdateResultTemplateRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { ResultTemplateRepository, type UpdateResultTemplateData } from './result-template.repository';
import { TechnicalServiceRepository } from './technical-service.repository';

function toItem(row: ResultTemplate): ResultTemplateItem {
  return {
    id: row.id,
    technicalServiceId: row.technicalServiceId,
    name: row.name,
    descriptionText: row.descriptionText,
    conclusionText: row.conclusionText,
    isDefault: row.isDefault,
    isActive: row.isActive,
    version: row.version,
  };
}

/**
 * "Mẫu kết quả" cận lâm sàng (Cận lâm sàng GĐ1, docs/DECISIONS.md #212) — lời Mô tả/Kết luận điền sẵn, DÙNG CHUNG
 * toàn phòng khám (đúng khuôn `PrescriptionTemplateService`). Mẫu KHÔNG chứa giá trị chỉ số xét nghiệm.
 */
@Injectable()
export class ResultTemplateService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: ResultTemplateRepository,
    private readonly serviceRepository: TechnicalServiceRepository,
  ) {}

  async list(tenantId: string, query: ListResultTemplatesQuery): Promise<ListResultTemplatesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.repository.list(tx, tenantId, { technicalServiceId: query.technicalServiceId, includeInactive: query.includeInactive });
      return { items: rows.map(toItem) };
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateResultTemplateRequest, meta: RequestMeta): Promise<ResultTemplateItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const service = await this.serviceRepository.findRowById(tx, tenantId, dto.technicalServiceId);
      if (!service) throw new BadRequestException('Dịch vụ kỹ thuật không tồn tại.');

      // Mẫu mặc định phải đang dùng — mẫu đã ẩn không tự điền vào phiếu.
      const isDefault = dto.isDefault && dto.isActive;
      if (isDefault) await this.repository.clearDefaultExcept(tx, tenantId, dto.technicalServiceId, null, actorId);

      const created = await this.repository.create(tx, tenantId, actorId, {
        technicalServiceId: dto.technicalServiceId,
        name: dto.name,
        descriptionText: dto.descriptionText?.trim() ? dto.descriptionText : null,
        conclusionText: dto.conclusionText?.trim() ? dto.conclusionText : null,
        isDefault,
        isActive: dto.isActive,
      });
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'result_template.created',
        entityType: 'result_template',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toItem(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateResultTemplateRequest, meta: RequestMeta): Promise<ResultTemplateItem> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();

      const nextActive = dto.isActive ?? existing.isActive;
      // Ẩn mẫu thì tự bỏ cờ mặc định; đặt mặc định thì bỏ cờ của mọi mẫu khác cùng dịch vụ.
      let nextDefault = dto.isDefault ?? existing.isDefault;
      if (!nextActive) nextDefault = false;

      const data: UpdateResultTemplateData = { isDefault: nextDefault };
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.descriptionText !== undefined) data.descriptionText = dto.descriptionText?.trim() ? dto.descriptionText : null;
      if (dto.conclusionText !== undefined) data.conclusionText = dto.conclusionText?.trim() ? dto.conclusionText : null;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;

      const resultingDescription = data.descriptionText !== undefined ? data.descriptionText : existing.descriptionText;
      const resultingConclusion = data.conclusionText !== undefined ? data.conclusionText : existing.conclusionText;
      if (!resultingDescription && !resultingConclusion) {
        throw new BadRequestException('Mẫu phải có Mô tả hoặc Kết luận.');
      }

      if (nextDefault && !existing.isDefault) {
        await this.repository.clearDefaultExcept(tx, tenantId, existing.technicalServiceId, id, actorId);
      }
      const count = await this.repository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, data);
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'result_template.updated',
        entityType: 'result_template',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const updated = await this.repository.findById(tx, tenantId, id);
      if (!updated) throw new NotFoundException();
      return toItem(updated);
    });
  }
}
