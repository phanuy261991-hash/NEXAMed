import { Injectable } from '@nestjs/common';
import type { Prisma, PrintDocumentType, PrintPaperSize, PrintTemplate } from '@prisma/client';

/** Chỗ DUY NHẤT gọi Prisma cho bảng `print_template` ("Quản lý mẫu in", docs/DECISIONS.md #211). */
@Injectable()
export class PrintTemplateRepository {
  list(tx: Prisma.TransactionClient, tenantId: string): Promise<PrintTemplate[]> {
    return tx.printTemplate.findMany({ where: { tenantId, deletedAt: null }, orderBy: [{ documentType: 'asc' }, { paperSize: 'asc' }] });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PrintTemplate | null> {
    return tx.printTemplate.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  findByTypeAndPaper(tx: Prisma.TransactionClient, tenantId: string, documentType: PrintDocumentType, paperSize: PrintPaperSize): Promise<PrintTemplate | null> {
    return tx.printTemplate.findFirst({ where: { tenantId, documentType, paperSize, deletedAt: null } });
  }

  countByType(tx: Prisma.TransactionClient, tenantId: string, documentType: PrintDocumentType): Promise<number> {
    return tx.printTemplate.count({ where: { tenantId, documentType, deletedAt: null } });
  }

  create(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    data: { documentType: PrintDocumentType; paperSize: PrintPaperSize; name: string; isDefault: boolean; configJson: Prisma.InputJsonValue },
  ): Promise<PrintTemplate> {
    return tx.printTemplate.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  /** Khoá lạc quan — `WHERE version = ?` rồi tăng 1; trả `count` (0 = lệch version hoặc không còn bản ghi). */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: { name?: string; isDefault?: boolean; configJson?: Prisma.InputJsonValue },
  ): Promise<number> {
    const result = await tx.printTemplate.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Bỏ cờ mặc định của MỌI bản khác cùng chứng từ (làm trước khi đặt bản mới là mặc định — partial unique index chỉ cho 1). */
  async clearDefaultExcept(tx: Prisma.TransactionClient, tenantId: string, actorId: string, documentType: PrintDocumentType, exceptId: string | null): Promise<void> {
    await tx.printTemplate.updateMany({
      where: { tenantId, documentType, isDefault: true, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { isDefault: false, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  async softDelete(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.printTemplate.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'deleted_by_user', isDefault: false, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
