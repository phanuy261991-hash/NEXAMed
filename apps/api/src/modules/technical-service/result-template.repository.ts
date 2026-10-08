import { Injectable } from '@nestjs/common';
import type { Prisma, ResultTemplate } from '@prisma/client';

export interface CreateResultTemplateData {
  technicalServiceId: string;
  name: string;
  descriptionText: string | null;
  conclusionText: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export type UpdateResultTemplateData = Partial<Omit<CreateResultTemplateData, 'technicalServiceId'>>;

/** Chỗ DUY NHẤT gọi Prisma cho `result_template` (Cận lâm sàng GĐ1, docs/DECISIONS.md #212). */
@Injectable()
export class ResultTemplateRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateResultTemplateData): Promise<ResultTemplate> {
    return tx.resultTemplate.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<ResultTemplate | null> {
    return tx.resultTemplate.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Không phân trang — mẫu dùng chung, vài chục đến vài trăm dòng/phòng khám (cùng khuôn `PrescriptionTemplateRepository`). */
  list(tx: Prisma.TransactionClient, tenantId: string, filter: { technicalServiceId?: string; includeInactive: boolean }): Promise<ResultTemplate[]> {
    return tx.resultTemplate.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filter.includeInactive ? {} : { isActive: true }),
        ...(filter.technicalServiceId ? { technicalServiceId: filter.technicalServiceId } : {}),
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateResultTemplateData,
  ): Promise<number> {
    const result = await tx.resultTemplate.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Bỏ cờ mặc định của MỌI mẫu khác cùng dịch vụ (partial unique cho phép tối đa 1 mặc định/dịch vụ). */
  async clearDefaultExcept(tx: Prisma.TransactionClient, tenantId: string, technicalServiceId: string, exceptId: string | null, actorId: string): Promise<void> {
    await tx.resultTemplate.updateMany({
      where: { tenantId, technicalServiceId, isDefault: true, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { isDefault: false, updatedBy: actorId, version: { increment: 1 } },
    });
  }
}
