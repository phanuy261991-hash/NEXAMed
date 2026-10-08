import { Injectable } from '@nestjs/common';
import type { Prisma, PriceList, PriceListItem } from '@prisma/client';

export interface CreatePriceListData {
  code: string;
  name: string;
  description: string | null;
  effectiveFrom: Date;
  effectiveTo: Date;
  priority: number;
}

export type UpdatePriceListData = Partial<Omit<CreatePriceListData, 'code'>> & { isActive?: boolean };

export interface PriceListLineData {
  itemKind: 'EXAM_TYPE' | 'TECHNICAL_SERVICE' | 'PACKAGE' | 'DRUG' | 'MEDICAL_SUPPLY';
  examTypeCode: string | null;
  technicalServiceId: string | null;
  servicePackageId: string | null;
  drugId: string | null;
  priceTypeCode: string | null;
  unitCode: string | null;
  mode: 'PERCENT_OFF' | 'NEW_PRICE';
  value: bigint;
  sortOrder: number;
}

/** Dòng bảng giá kèm bảng giá cha — dùng khi tính giá (chỉ lấy bảng đang hiệu lực đúng ngày). */
export type ActivePriceListLine = PriceListItem & { priceList: Pick<PriceList, 'id' | 'code' | 'name' | 'priority' | 'effectiveFrom' | 'createdAt'> };

/** Chỗ DUY NHẤT gọi Prisma cho `price_list` + `price_list_item` (Cận lâm sàng GĐ2, docs/DECISIONS.md #212). */
@Injectable()
export class PriceListRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreatePriceListData): Promise<PriceList> {
    return tx.priceList.create({ data: { tenantId, ...data, createdBy: actorId, updatedBy: actorId } });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PriceList | null> {
    return tx.priceList.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Mọi bảng giá (kể cả đã hết hạn/ngừng) — danh sách quản trị; số lượng nhỏ (vài chục/năm) nên không phân trang. */
  list(tx: Prisma.TransactionClient, tenantId: string, search?: string): Promise<PriceList[]> {
    return tx.priceList.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ effectiveFrom: 'desc' }, { code: 'desc' }],
    });
  }

  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdatePriceListData,
  ): Promise<number> {
    const result = await tx.priceList.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  // ---- dòng ----

  listLines(tx: Prisma.TransactionClient, tenantId: string, priceListId: string): Promise<PriceListItem[]> {
    return tx.priceListItem.findMany({
      where: { tenantId, priceListId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Đếm dòng theo bảng giá (cột "Mặt hàng" ở danh sách) — một truy vấn gom, không N+1. */
  async countLinesByPriceList(tx: Prisma.TransactionClient, tenantId: string, priceListIds: string[]): Promise<Map<string, number>> {
    if (priceListIds.length === 0) return new Map();
    const groups = await tx.priceListItem.groupBy({
      by: ['priceListId'],
      where: { tenantId, priceListId: { in: priceListIds }, deletedAt: null },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.priceListId, g._count._all]));
  }

  /** Thay TOÀN BỘ dòng — xoá mềm dòng cũ rồi tạo lại, đúng khuôn các bảng con khác. */
  async replaceLines(tx: Prisma.TransactionClient, tenantId: string, priceListId: string, actorId: string, lines: PriceListLineData[]): Promise<void> {
    await tx.priceListItem.updateMany({
      where: { tenantId, priceListId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'replaced', updatedBy: actorId },
    });
    if (lines.length > 0) {
      await tx.priceListItem.createMany({
        data: lines.map((line) => ({ tenantId, priceListId, ...line, createdBy: actorId, updatedBy: actorId })),
      });
    }
  }

  /**
   * Mọi dòng của các bảng giá ĐANG HIỆU LỰC vào `date` (còn bật, trong khoảng ngày) — nguồn cho mọi phép tính giá.
   * `onlyDrugIds`/... lọc theo mặt hàng khi nơi gọi chỉ cần vài mặt hàng (phát thuốc, tiếp nhận) để không quét cả bảng.
   */
  listActiveLines(
    tx: Prisma.TransactionClient,
    tenantId: string,
    date: Date,
    scope: { examTypeCodes?: string[]; technicalServiceIds?: string[]; servicePackageIds?: string[]; drugIds?: string[] },
  ): Promise<ActivePriceListLine[]> {
    const or: Prisma.PriceListItemWhereInput[] = [];
    if (scope.examTypeCodes && scope.examTypeCodes.length > 0) or.push({ examTypeCode: { in: scope.examTypeCodes } });
    if (scope.technicalServiceIds && scope.technicalServiceIds.length > 0) or.push({ technicalServiceId: { in: scope.technicalServiceIds } });
    if (scope.servicePackageIds && scope.servicePackageIds.length > 0) or.push({ servicePackageId: { in: scope.servicePackageIds } });
    if (scope.drugIds && scope.drugIds.length > 0) or.push({ drugId: { in: scope.drugIds } });
    if (or.length === 0) return Promise.resolve([]);
    return tx.priceListItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: or,
        priceList: { tenantId, deletedAt: null, isActive: true, effectiveFrom: { lte: date }, effectiveTo: { gte: date } },
      },
      include: { priceList: { select: { id: true, code: true, name: true, priority: true, effectiveFrom: true, createdAt: true } } },
    });
  }

  /**
   * "Tra thử giá": MỌI dòng chứa mặt hàng (kể cả bảng chưa tới/đã hết hạn/đã ngừng) để UI hiện bảng nào đè bảng nào.
   * Trả kèm bảng cha đầy đủ trạng thái để nơi gọi tự đánh dấu `inEffect`.
   */
  listLinesForItem(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ref: { examTypeCode?: string; technicalServiceId?: string; servicePackageId?: string; drugId?: string },
  ): Promise<(PriceListItem & { priceList: PriceList })[]> {
    return tx.priceListItem.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(ref.examTypeCode ? { examTypeCode: ref.examTypeCode } : {}),
        ...(ref.technicalServiceId ? { technicalServiceId: ref.technicalServiceId } : {}),
        ...(ref.servicePackageId ? { servicePackageId: ref.servicePackageId } : {}),
        ...(ref.drugId ? { drugId: ref.drugId } : {}),
        priceList: { tenantId, deletedAt: null },
      },
      include: { priceList: true },
    });
  }
}
