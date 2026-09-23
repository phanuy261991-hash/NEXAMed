import { Injectable } from '@nestjs/common';
import type { GetStockLedgerReportQuery, GetStockLedgerReportResponse, StockLedgerReportItem } from '@nexamed/shared';
import type { Prisma } from '@prisma/client';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { DrugRepository } from '../drug/drug.repository';
import { WarehouseRepository } from '../drug/warehouse.repository';
import { StockLedgerRepository } from './stock-ledger.repository';

/**
 * "Báo cáo Nhập-Xuất-Tồn" (Kho Thuốc GĐ4, "Báo cáo Nhập-Xuất-Tồn", docs/DECISIONS.md #170, kế hoạch
 * kỹ thuật bright-bubbling-axolotl.md mục 5, mockup đã duyệt) — bảng kê Đầu kỳ/Nhập/Xuất/Cuối kỳ
 * theo mặt hàng trong khoảng ngày, đúng khuôn "Báo cáo dòng tiền" của Sổ quỹ
 * (`CashBookReportService.getCashFlowReport()`). Mỗi dòng = 1 mặt hàng (không phải 1 chứng từ).
 */
@Injectable()
export class StockLedgerReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly stockLedgerRepository: StockLedgerRepository,
    private readonly drugRepository: DrugRepository,
    private readonly warehouseRepository: WarehouseRepository,
  ) {}

  async getReport(tenantId: string, query: GetStockLedgerReportQuery): Promise<GetStockLedgerReportResponse> {
    const fromAt = new Date(`${query.from}T00:00:00+07:00`);
    const toAt = new Date(`${query.to}T23:59:59.999+07:00`);
    const filter = { warehouseId: query.warehouseId, drugId: query.drugId };

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [openingRows, inRows, outRows] = await Promise.all([
        this.stockLedgerRepository.sumQuantityGrouped(tx, tenantId, { before: fromAt, ...filter }),
        this.stockLedgerRepository.sumQuantityGrouped(tx, tenantId, { from: fromAt, to: toAt, quantitySign: 'positive', ...filter }),
        this.stockLedgerRepository.sumQuantityGrouped(tx, tenantId, { from: fromAt, to: toAt, quantitySign: 'negative', ...filter }),
      ]);

      type Bucket = { openingQuantity: number; totalIn: number; totalOut: number };
      const buckets = new Map<string, Bucket>();
      const keyOf = (drugId: string, warehouseId: string) => `${drugId}:${warehouseId}`;
      const ensure = (drugId: string, warehouseId: string): Bucket => {
        const key = keyOf(drugId, warehouseId);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { openingQuantity: 0, totalIn: 0, totalOut: 0 };
          buckets.set(key, bucket);
        }
        return bucket;
      };
      for (const row of openingRows) ensure(row.drugId, row.warehouseId).openingQuantity = row.sum;
      for (const row of inRows) ensure(row.drugId, row.warehouseId).totalIn = row.sum;
      // `sumQuantityGrouped(quantitySign:'negative')` trả tổng ÂM — đổi dấu để "Xuất" hiển thị dương.
      for (const row of outRows) ensure(row.drugId, row.warehouseId).totalOut = -row.sum;

      const drugIds = [...new Set([...buckets.keys()].map((k) => k.split(':')[0]!))];
      const warehouseIds = [...new Set([...buckets.keys()].map((k) => k.split(':')[1]!))];
      const [drugs, warehouses] = await Promise.all([
        this.drugRepository.findByIds(tx, tenantId, drugIds),
        this.warehouseRepository.list(tx, tenantId),
      ]);
      const drugById = new Map(drugs.map((d) => [d.id, d]));
      const warehouseById = new Map(warehouses.filter((w) => warehouseIds.includes(w.id)).map((w) => [w.id, w]));

      const items: StockLedgerReportItem[] = [...buckets.entries()]
        .map(([key, bucket]) => {
          const [drugId, warehouseId] = key.split(':') as [string, string];
          const drug = drugById.get(drugId);
          const warehouse = warehouseById.get(warehouseId);
          if (!drug || !warehouse) return null;
          return {
            drugId,
            drugCode: drug.code,
            drugName: drug.name,
            unitCode: drug.baseUnitCode,
            warehouseId,
            warehouseName: warehouse.name,
            openingQuantity: bucket.openingQuantity,
            totalIn: bucket.totalIn,
            totalOut: bucket.totalOut,
            closingQuantity: bucket.openingQuantity + bucket.totalIn - bucket.totalOut,
          } satisfies StockLedgerReportItem;
        })
        .filter((item): item is StockLedgerReportItem => item !== null)
        .sort((a, b) => a.drugName.localeCompare(b.drugName, 'vi'));

      return {
        items,
        totalOpeningQuantity: items.reduce((s, i) => s + i.openingQuantity, 0),
        totalIn: items.reduce((s, i) => s + i.totalIn, 0),
        totalOut: items.reduce((s, i) => s + i.totalOut, 0),
        totalClosingQuantity: items.reduce((s, i) => s + i.closingQuantity, 0),
      };
    });
  }

  /** Ghi audit log lượt Xuất Excel — bài học S6-03 "mọi export phải có audit". */
  async recordExportAudit(tenantId: string, actorId: string, scope: Prisma.InputJsonValue, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(tenantId, (tx) =>
      writeAuditLog(tx, tenantId, {
        actorId,
        action: 'stock_ledger_report.exported',
        entityType: 'stock_ledger_report',
        entityId: tenantId,
        afterJson: scope,
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
}
