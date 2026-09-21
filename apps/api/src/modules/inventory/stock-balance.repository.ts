import { Injectable } from '@nestjs/common';
import type { Prisma, StockBalance } from '@prisma/client';

export interface AggregatedBalanceRow {
  drugId: string;
  warehouseId: string;
  quantityOnHand: number;
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `stock_balance` — cache số dư luỹ kế, cập nhật ĐỒNG BỘ trong
 * CÙNG transaction ghi `stock_ledger` (Kho Thuốc GĐ2). `batchId=null` ⇔ thuốc KHÔNG quản lý theo
 * lô (đúng 1 dòng/drug+warehouse); `batchId` có giá trị ⇔ 1 dòng/lô — 2 partial unique index tách
 * biệt ở DB (không khai `@@unique` ở Prisma, xem migration), nên KHÔNG dùng được `upsert()` chuẩn
 * của Prisma — tự cài findFirst rồi create/update, đúng khuôn "read rồi act trong cùng transaction"
 * đã chấp nhận ở dự án cho các trường hợp tương tự quy mô nhỏ (rủi ro race giữa 2 phiếu nhập KHÁC
 * NHAU cùng đụng đúng 1 dòng cân bằng — hiếm ở quy mô v1 — nếu xảy ra sẽ lộ ra bằng lỗi vi phạm
 * unique index thay vì âm thầm sai số liệu, chấp nhận được cho GĐ2). */
@Injectable()
export class StockBalanceRepository {
  findByKey(tx: Prisma.TransactionClient, tenantId: string, drugId: string, warehouseId: string, batchId: string | null): Promise<StockBalance | null> {
    return tx.stockBalance.findFirst({ where: { tenantId, drugId, warehouseId, batchId, deletedAt: null } });
  }

  /** Có bất kỳ tồn kho nào (mọi kho, mọi lô) khác 0 không — dùng để chặn đổi `drug.isBatchManaged`
   * khi thuốc đã có tồn (đổi cờ sau khi có tồn làm tồn cũ "kẹt" dưới khoá lô/phi-lô cũ, xem sự cố
   * thật đã gặp với dữ liệu test Playwright, 21/09/2026). */
  async hasAnyStock(tx: Prisma.TransactionClient, tenantId: string, drugId: string): Promise<boolean> {
    const row = await tx.stockBalance.findFirst({ where: { tenantId, drugId, deletedAt: null, quantityOnHand: { not: 0 } }, select: { id: true } });
    return row !== null;
  }

  /** Cộng thêm `quantityDelta` vào dòng đã có (tạo mới nếu chưa có). `averageUnitCost` — chỉ truyền
   * khi `batchId=null` (bình quân gia quyền toàn kho, Service đã tính sẵn); bỏ qua khi có `batchId`
   * (giá vốn đích danh nằm ở `inventory_batch.unitCost`, không lặp lại ở đây). */
  async upsertQuantity(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    params: { drugId: string; warehouseId: string; batchId: string | null; quantityDelta: number; averageUnitCost?: bigint | null },
  ): Promise<void> {
    const existing = await this.findByKey(tx, tenantId, params.drugId, params.warehouseId, params.batchId);
    if (existing) {
      await tx.stockBalance.updateMany({
        where: { tenantId, id: existing.id },
        data: {
          quantityOnHand: { increment: params.quantityDelta },
          ...(params.averageUnitCost !== undefined ? { averageUnitCost: params.averageUnitCost } : {}),
          updatedBy: actorId,
          version: { increment: 1 },
        },
      });
      return;
    }
    await tx.stockBalance.create({
      data: {
        tenantId,
        drugId: params.drugId,
        warehouseId: params.warehouseId,
        batchId: params.batchId,
        quantityOnHand: params.quantityDelta,
        averageUnitCost: params.averageUnitCost ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  /** "Tồn kho" (view "Theo mặt hàng") — tổng `quantityOnHand` GỘP mọi lô, theo từng (drug, warehouse). */
  async listAggregated(tx: Prisma.TransactionClient, tenantId: string, warehouseId?: string): Promise<AggregatedBalanceRow[]> {
    const rows = await tx.stockBalance.groupBy({
      by: ['drugId', 'warehouseId'],
      where: { tenantId, warehouseId, deletedAt: null },
      _sum: { quantityOnHand: true },
    });
    return rows.map((r) => ({ drugId: r.drugId, warehouseId: r.warehouseId, quantityOnHand: r._sum.quantityOnHand ?? 0 }));
  }
}
