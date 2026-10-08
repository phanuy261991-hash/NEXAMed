import { Injectable } from '@nestjs/common';
import type { Prisma, ServicePackage, ServicePackageItem } from '@prisma/client';

export interface CreateServicePackageData {
  code: string;
  name: string;
  pricingMode: 'FIXED' | 'SUM_MINUS_DISCOUNT';
  fixedPrice: bigint | null;
  discountType: 'PERCENT' | 'AMOUNT' | null;
  discountValue: bigint | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  sortOrder: number;
}

export type UpdateServicePackageData = Partial<Omit<CreateServicePackageData, 'code'>>;

export interface ServicePackageItemData {
  itemKind: 'EXAM_TYPE' | 'TECHNICAL_SERVICE';
  examTypeCode: string | null;
  technicalServiceId: string | null;
  quantity: number;
  sortOrder: number;
}

export interface ServicePackageFilter {
  search?: string;
  includeInactive: boolean;
}

/** Chỗ DUY NHẤT gọi Prisma cho `service_package` + `service_package_item` (Cận lâm sàng GĐ2, docs/DECISIONS.md #212). */
@Injectable()
export class ServicePackageRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateServicePackageData): Promise<ServicePackage> {
    return tx.servicePackage.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<ServicePackage | null> {
    return tx.servicePackage.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  findByIds(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<ServicePackage[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return tx.servicePackage.findMany({ where: { tenantId, id: { in: ids }, deletedAt: null } });
  }

  /** Không phân trang — vài chục gói/phòng khám, cùng lý do `TechnicalServiceRepository.list()`. */
  list(tx: Prisma.TransactionClient, tenantId: string, filter: ServicePackageFilter): Promise<ServicePackage[]> {
    return tx.servicePackage.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(filter.includeInactive ? {} : { isActive: true }),
        ...(filter.search ? { OR: [{ code: { contains: filter.search, mode: 'insensitive' } }, { name: { contains: filter.search, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async countActive(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    return tx.servicePackage.count({ where: { tenantId, deletedAt: null, isActive: true } });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateServicePackageData,
  ): Promise<number> {
    const result = await tx.servicePackage.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  // ---- dịch vụ con ----

  listItems(tx: Prisma.TransactionClient, tenantId: string, packageIds: string[]): Promise<ServicePackageItem[]> {
    if (packageIds.length === 0) return Promise.resolve([]);
    return tx.servicePackageItem.findMany({
      where: { tenantId, servicePackageId: { in: packageIds }, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Thay TOÀN BỘ dịch vụ con — xoá mềm dòng cũ rồi tạo lại (cùng khuôn `TechnicalServiceRepository.replaceIndicatorLinks`).
   * Xoá mềm TRƯỚC để các partial unique (`WHERE deleted_at IS NULL`) không cản chính lần sửa này. */
  async replaceItems(tx: Prisma.TransactionClient, tenantId: string, packageId: string, actorId: string, items: ServicePackageItemData[]): Promise<void> {
    await tx.servicePackageItem.updateMany({
      where: { tenantId, servicePackageId: packageId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.servicePackageItem.createMany({
        data: items.map((item) => ({ tenantId, servicePackageId: packageId, ...item, createdBy: actorId, updatedBy: actorId })),
      });
    }
  }
}
