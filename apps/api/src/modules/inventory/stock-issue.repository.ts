import { Injectable } from '@nestjs/common';
import type { Prisma, StockIssue, StockIssueType } from '@prisma/client';

export interface StockIssueLineData {
  prescriptionItemId: string | null;
  drugId: string;
  batchId: string | null;
  quantity: number;
  unitCost: bigint;
  sellPrice: bigint;
  lineAmount: bigint;
}

export interface CreateStockIssueData {
  issueNo: string;
  warehouseId: string;
  /** `null` CHỈ hợp lệ cho `issueType != 'RETAIL_SALE'` (Kho Thuốc GĐ4 #170 — ví dụ `COUNT_SHORTAGE`
   * tự sinh từ Kiểm kê, không gắn đơn thuốc nào). */
  prescriptionId: string | null;
  issueType: StockIssueType;
  countId: string | null;
  /** Kho Thuốc GĐ4 (#170) — trỏ về `stock_transfer` khi phiếu này TỰ SINH từ Duyệt xuất
   * (`issueType='TRANSFER_OUT'`). `null` cho mọi phiếu xuất khác. */
  transferId: string | null;
  occurredAt: Date;
  note: string | null;
  totalAmount: bigint;
  lines: StockIssueLineData[];
}

const LINE_INCLUDE = {
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' as const },
  include: { drug: { select: { code: true, name: true } }, batch: { select: { batchNo: true } } },
} satisfies Prisma.StockIssue$linesArgs;

const CONTEXT_INCLUDE = {
  lines: LINE_INCLUDE,
  warehouse: { select: { name: true } },
  prescription: { select: { encounter: { select: { id: true, encounterNo: true, patient: { select: { patientCode: true, fullName: true } } } } } },
} satisfies Prisma.StockIssueInclude;

export type StockIssueWithContext = Prisma.StockIssueGetPayload<{ include: typeof CONTEXT_INCLUDE }>;

export interface StockIssueListRow extends StockIssue {
  warehouse: { name: string };
  // Nullable từ Kho Thuốc GĐ4 (#170) — `COUNT_SHORTAGE` tự sinh không có `prescriptionId`.
  prescription: { encounter: { id: string; encounterNo: string; patient: { patientCode: string; fullName: string } } } | null;
  _count: { lines: number };
}

export interface ListStockIssuesFilter {
  warehouseId?: string;
  status?: StockIssue['status'];
  issueType?: StockIssueType;
  from?: Date;
  to?: Date;
  q?: string;
  cursor?: string;
  take: number;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `stock_issue`/`stock_issue_line` (Kho Thuốc GĐ3, #163). */
@Injectable()
export class StockIssueRepository {
  /** 2 lệnh riêng (không nested create) — cùng lý do `StockReceiptRepository.create()` (composite
   * FK chia sẻ `tenantId`, Prisma loại `tenantId` khỏi kiểu nested-create trong trường hợp này). */
  async create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateStockIssueData): Promise<StockIssueWithContext> {
    const header = await tx.stockIssue.create({
      data: {
        tenantId,
        issueNo: data.issueNo,
        warehouseId: data.warehouseId,
        prescriptionId: data.prescriptionId,
        issueType: data.issueType,
        countId: data.countId,
        transferId: data.transferId,
        occurredAt: data.occurredAt,
        note: data.note,
        totalAmount: data.totalAmount,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    if (data.lines.length > 0) {
      await tx.stockIssueLine.createMany({
        data: data.lines.map((line) => ({
          tenantId,
          issueId: header.id,
          prescriptionItemId: line.prescriptionItemId,
          drugId: line.drugId,
          batchId: line.batchId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          sellPrice: line.sellPrice,
          lineAmount: line.lineAmount,
          createdBy: actorId,
          updatedBy: actorId,
        })),
      });
    }
    const created = await tx.stockIssue.findFirst({ where: { tenantId, id: header.id }, include: CONTEXT_INCLUDE });
    return created as StockIssueWithContext;
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<StockIssue | null> {
    return tx.stockIssue.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Dùng cho đường XEM (GET chi tiết) — KHÔNG lọc `deletedAt`, phiếu đã huỷ vẫn xem được (chỉ đọc). */
  findByIdAnyWithContext(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<StockIssueWithContext | null> {
    return tx.stockIssue.findFirst({ where: { tenantId, id }, include: CONTEXT_INCLUDE }) as Promise<StockIssueWithContext | null>;
  }

  async list(tx: Prisma.TransactionClient, tenantId: string, filter: ListStockIssuesFilter): Promise<StockIssueListRow[]> {
    const where: Prisma.StockIssueWhereInput = {
      tenantId,
      warehouseId: filter.warehouseId,
      status: filter.status,
      issueType: filter.issueType,
      occurredAt: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
    };
    if (filter.q) {
      where.OR = [
        { issueNo: { contains: filter.q, mode: 'insensitive' } },
        { prescription: { encounter: { patient: { fullName: { contains: filter.q, mode: 'insensitive' } } } } },
        { prescription: { encounter: { patient: { patientCode: { contains: filter.q, mode: 'insensitive' } } } } },
      ];
    }
    const rows = await tx.stockIssue.findMany({
      where,
      include: {
        warehouse: { select: { name: true } },
        prescription: { select: { encounter: { select: { id: true, encounterNo: true, patient: { select: { patientCode: true, fullName: true } } } } } },
        _count: { select: { lines: { where: { deletedAt: null } } } },
      },
      orderBy: { id: 'desc' },
      take: filter.take,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    return rows as StockIssueListRow[];
  }

  /** Huỷ phiếu ĐÃ PHÁT — `WHERE status='POSTED'` chống huỷ trùng, cùng kỹ thuật `StockReceiptRepository.voidPosted()`. */
  async voidPosted(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string, reason: string): Promise<number> {
    const result = await tx.stockIssue.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'POSTED' },
      data: { status: 'VOIDED', voidedBy: actorId, voidedAt: new Date(), voidReason: reason, deletedAt: new Date(), deletedReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Tổng đã phát (chỉ tính phiếu CÒN HIỆU LỰC, `status='POSTED'`) của từng dòng kê đơn — dùng để
   * tính "còn lại" (chặn vượt kê đơn) và trạng thái hàng đợi "Phát thuốc". */
  async sumDispensedForItems(tx: Prisma.TransactionClient, tenantId: string, prescriptionItemIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (prescriptionItemIds.length === 0) return map;
    const rows = await tx.stockIssueLine.groupBy({
      by: ['prescriptionItemId'],
      where: { tenantId, prescriptionItemId: { in: prescriptionItemIds }, deletedAt: null, issue: { status: 'POSTED' } },
      _sum: { quantity: true },
    });
    for (const row of rows) {
      if (row.prescriptionItemId) map.set(row.prescriptionItemId, row._sum.quantity ?? 0);
    }
    return map;
  }

  /**
   * Hàng đợi "Phát thuốc" — mọi đơn ĐÃ KÝ (`signedAt IS NOT NULL`). `q` có giá trị → tìm XUYÊN SUỐT
   * mọi thời điểm ký (không giới hạn ngày, không giới hạn trạng thái lượt khám/hoá đơn — dược sĩ tìm
   * đúng đơn khi khách quay lại không nhớ mã). `q` rỗng → mặc định chỉ đơn ký trong `cutoff` gần
   * đây (`includeOlder=true` bỏ giới hạn này). Service tự lọc lại "chưa phát hết" sau khi tính tổng
   * đã phát (không lọc được ở tầng SQL vì cần SUM riêng `stock_issue_line`).
   */
  async listSignedPrescriptionsForDispenseQueue(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { qRaw?: string; qNormalized?: string; includeOlder: boolean; cutoff: Date },
  ) {
    const where: Prisma.PrescriptionWhereInput = { tenantId, signedAt: { not: null }, deletedAt: null };
    if (params.qRaw) {
      where.encounter = {
        patient: {
          OR: [
            { patientCode: { startsWith: params.qRaw, mode: 'insensitive' } },
            { phone: { startsWith: params.qRaw } },
            { searchKey: { contains: params.qNormalized } },
          ],
        },
      };
    } else if (!params.includeOlder) {
      where.signedAt = { gte: params.cutoff };
    }
    return tx.prescription.findMany({
      where,
      select: {
        id: true,
        signedAt: true,
        items: { where: { deletedAt: null }, select: { id: true, quantity: true } },
        encounter: {
          select: {
            id: true,
            encounterNo: true,
            patient: { select: { id: true, patientCode: true, fullName: true, phone: true } },
          },
        },
      },
      orderBy: { signedAt: 'desc' },
    });
  }
}
