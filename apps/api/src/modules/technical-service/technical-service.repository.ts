import { Injectable } from '@nestjs/common';
import type { Prisma, TechnicalService, TechnicalServiceIndicator, TechnicalServicePrice } from '@prisma/client';

export interface CreateTechnicalServiceData {
  code: string;
  name: string;
  shortName: string | null;
  nationalCode: string | null;
  serviceKind: 'LAB' | 'IMAGING' | 'FUNCTIONAL';
  categoryCode: string | null;
  specimenTypeCode: string | null;
  isPerformedInHouse: boolean;
  departmentId: string | null;
  turnaroundMinutes: number | null;
  resultType: 'INDICATORS' | 'NARRATIVE' | 'BOTH';
  isActive: boolean;
  sortOrder: number;
}

export type UpdateTechnicalServiceData = Partial<Omit<CreateTechnicalServiceData, 'code' | 'serviceKind'>>;

export interface TechnicalServiceFilter {
  kind?: 'LAB' | 'IMAGING' | 'FUNCTIONAL';
  /** Đã chuẩn hoá (bỏ dấu, chữ thường) hoặc nguyên văn — so khớp `contains` không phân biệt hoa/thường. */
  search?: string;
  categoryCode?: string;
  inHouse?: boolean;
  includeInactive: boolean;
}

export interface TechnicalServiceRow extends TechnicalService {
  department: { name: string } | null;
  _count: { indicators: number };
}

export interface CreatePriceData {
  priceTypeCode: string;
  unitCode: string;
  amount: bigint;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface IndicatorLinkData {
  indicatorId: string;
  sortOrder: number;
  interpretationText: string | null;
}

export interface IndicatorLinkRow extends TechnicalServiceIndicator {
  indicator: { code: string; name: string; abbreviation: string | null; unit: string | null };
}

const LIST_INCLUDE = {
  department: { select: { name: true } },
  _count: { select: { indicators: { where: { deletedAt: null } } } },
} as const;

/** Chỗ DUY NHẤT gọi Prisma cho `technical_service` + `technical_service_price` + `technical_service_indicator`
 * (Cận lâm sàng GĐ1, docs/DECISIONS.md #212). */
@Injectable()
export class TechnicalServiceRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateTechnicalServiceData): Promise<TechnicalService> {
    return tx.technicalService.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  findRowById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<TechnicalServiceRow | null> {
    return tx.technicalService.findFirst({ where: { tenantId, id, deletedAt: null }, include: LIST_INCLUDE });
  }

  /** Cận lâm sàng GĐ2 — gói dịch vụ/bảng giá hiển thị nhiều dịch vụ cùng lúc, không N+1. */
  findRowsByIds(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<TechnicalServiceRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return tx.technicalService.findMany({ where: { tenantId, id: { in: ids }, deletedAt: null }, include: LIST_INCLUDE });
  }

  /** Không phân trang — danh mục vài trăm dịch vụ/phòng khám, cùng lý do `SupplierRepository.list()`. */
  list(tx: Prisma.TransactionClient, tenantId: string, filter: TechnicalServiceFilter): Promise<TechnicalServiceRow[]> {
    const where: Prisma.TechnicalServiceWhereInput = {
      tenantId,
      deletedAt: null,
      ...(filter.includeInactive ? {} : { isActive: true }),
      ...(filter.kind ? { serviceKind: filter.kind } : {}),
      ...(filter.categoryCode ? { categoryCode: filter.categoryCode } : {}),
      ...(filter.inHouse === undefined ? {} : { isPerformedInHouse: filter.inHouse }),
      ...(filter.search
        ? {
            OR: [
              { code: { contains: filter.search, mode: 'insensitive' } },
              { name: { contains: filter.search, mode: 'insensitive' } },
              { shortName: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return tx.technicalService.findMany({ where, include: LIST_INCLUDE, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  }

  /** Đếm theo loại — KHÔNG phụ thuộc bộ lọc kind/search (khung "Nhóm dịch vụ" luôn hiện đủ số). */
  async countsByKind(tx: Prisma.TransactionClient, tenantId: string, includeInactive: boolean): Promise<Record<'LAB' | 'IMAGING' | 'FUNCTIONAL', number>> {
    const groups = await tx.technicalService.groupBy({
      by: ['serviceKind'],
      where: { tenantId, deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      _count: { _all: true },
    });
    const result = { LAB: 0, IMAGING: 0, FUNCTIONAL: 0 };
    for (const g of groups) result[g.serviceKind] = g._count._all;
    return result;
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateTechnicalServiceData,
  ): Promise<number> {
    const result = await tx.technicalService.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Cập nhật `version`/`updatedBy` khi CHỈ đổi đơn giá/chỉ số (bảng con), không đổi field nào của dịch vụ. */
  bumpVersion(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    return this.updateIfVersionMatches(tx, tenantId, id, expectedVersion, actorId, {});
  }

  // ---- đơn giá ----

  listPrices(tx: Prisma.TransactionClient, tenantId: string, serviceIds: string[]): Promise<TechnicalServicePrice[]> {
    if (serviceIds.length === 0) return Promise.resolve([]);
    return tx.technicalServicePrice.findMany({
      where: { tenantId, technicalServiceId: { in: serviceIds }, deletedAt: null },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** Thay TOÀN BỘ đơn giá — xoá mềm dòng cũ rồi tạo lại (cùng khuôn `ExamTypePriceRepository.replaceForExamType`).
   * Xoá mềm TRƯỚC khi tạo để ràng buộc chồng lấn (`WHERE deleted_at IS NULL`) không cản chính lần sửa này. */
  async replacePrices(tx: Prisma.TransactionClient, tenantId: string, serviceId: string, actorId: string, items: CreatePriceData[]): Promise<void> {
    await tx.technicalServicePrice.updateMany({
      where: { tenantId, technicalServiceId: serviceId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.technicalServicePrice.createMany({
        data: items.map((item) => ({ tenantId, technicalServiceId: serviceId, ...item, createdBy: actorId, updatedBy: actorId })),
      });
    }
  }

  // ---- chỉ số của dịch vụ ----

  listIndicatorLinks(tx: Prisma.TransactionClient, tenantId: string, serviceId: string): Promise<IndicatorLinkRow[]> {
    return tx.technicalServiceIndicator.findMany({
      where: { tenantId, technicalServiceId: serviceId, deletedAt: null },
      include: { indicator: { select: { code: true, name: true, abbreviation: true, unit: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async replaceIndicatorLinks(tx: Prisma.TransactionClient, tenantId: string, serviceId: string, actorId: string, items: IndicatorLinkData[]): Promise<void> {
    await tx.technicalServiceIndicator.updateMany({
      where: { tenantId, technicalServiceId: serviceId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (items.length > 0) {
      await tx.technicalServiceIndicator.createMany({
        data: items.map((item) => ({ tenantId, technicalServiceId: serviceId, ...item, createdBy: actorId, updatedBy: actorId })),
      });
    }
  }
}
