import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AdviceTemplate as AdviceTemplateRow } from '@prisma/client';
import { AdviceTemplateDuplicateNameError, ConcurrentModificationError } from '@nexamed/core';
import type { AdviceTemplate, CreateAdviceTemplateRequest, ListAdviceTemplatesResponse, UpdateAdviceTemplateRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { AdviceTemplateRepository } from './advice-template.repository';

function isNameConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * "Mẫu lời dặn" (docs/DECISIONS.md #222) — CRUD đơn giản, dùng CHUNG toàn phòng khám (không tách theo bác sĩ, đúng "Đơn thuốc mẫu"). Tên không trùng (không phân biệt hoa thường)
 * do unique index ở DB đảm bảo, service chỉ đổi lỗi DB thành lỗi nghiệp vụ. Ẩn mẫu = `isActive=false`.
 */
@Injectable()
export class AdviceTemplateService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: AdviceTemplateRepository,
  ) {}

  async list(tenantId: string, includeInactive = false): Promise<ListAdviceTemplatesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.repository.list(tx, tenantId, includeInactive);
      return { items: rows.map((r) => this.toDto(r)) };
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateAdviceTemplateRequest, meta: RequestMeta): Promise<AdviceTemplate> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let created: AdviceTemplateRow;
      try {
        created = await this.repository.create(tx, tenantId, actorId, { name: dto.name, content: dto.content });
      } catch (err) {
        if (isNameConflict(err)) throw new AdviceTemplateDuplicateNameError();
        throw err;
      }
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'advice_template.created',
        entityType: 'advice_template',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.toDto(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateAdviceTemplateRequest, meta: RequestMeta): Promise<AdviceTemplate> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.repository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();

      let count: number;
      try {
        count = await this.repository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, { name: dto.name, content: dto.content, isActive: dto.isActive });
      } catch (err) {
        if (isNameConflict(err)) throw new AdviceTemplateDuplicateNameError();
        throw err;
      }
      if (count === 0) throw new ConcurrentModificationError();

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'advice_template.updated',
        entityType: 'advice_template',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const updated = await this.repository.findById(tx, tenantId, id);
      if (!updated) throw new NotFoundException();
      return this.toDto(updated);
    });
  }

  private toDto(row: AdviceTemplateRow): AdviceTemplate {
    return { id: row.id, name: row.name, content: row.content, isActive: row.isActive, version: row.version };
  }
}
