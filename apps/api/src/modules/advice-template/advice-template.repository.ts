import { Injectable } from '@nestjs/common';
import type { AdviceTemplate, Prisma } from '@prisma/client';

/** Chỗ DUY NHẤT gọi Prisma cho bảng `advice_template` ("Mẫu lời dặn", docs/DECISIONS.md #222) — đúng khuôn `PrescriptionTemplateRepository` nhưng không có dòng con. */
@Injectable()
export class AdviceTemplateRepository {
  list(tx: Prisma.TransactionClient, tenantId: string, includeInactive: boolean): Promise<AdviceTemplate[]> {
    return tx.adviceTemplate.findMany({
      where: { tenantId, deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<AdviceTemplate | null> {
    return tx.adviceTemplate.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: { name: string; content: string }): Promise<AdviceTemplate> {
    return tx.adviceTemplate.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  /** `WHERE version = ?` + tăng version (optimistic lock); trả số dòng thật sự đổi — 0 là lệch version/không tồn tại. */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: { name?: string; content?: string; isActive?: boolean },
  ): Promise<number> {
    const result = await tx.adviceTemplate.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
