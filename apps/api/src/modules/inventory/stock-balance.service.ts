import { Inject, Injectable } from '@nestjs/common';
import { CLINIC_CONFIG_READER_PORT, computeExpiryStatus, toVietnamDateParts, type ClinicConfigReaderPort } from '@nexamed/core';
import type {
  GetDrugBatchBalancesResponse,
  ListStockBalancesQuery,
  ListStockBalancesResponse,
  ListStockExpiryWarningsQuery,
  ListStockExpiryWarningsResponse,
  StockBalanceItem,
  StockBalanceStatus,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { DrugRepository } from '../drug/drug.repository';
import { WarehouseRepository } from '../drug/warehouse.repository';
import { InventoryBatchRepository } from './inventory-batch.repository';
import { StockBalanceRepository } from './stock-balance.repository';

function resolveStatus(quantityOnHand: number, min: number | null, max: number | null): StockBalanceStatus {
  if (quantityOnHand <= 0) return 'OUT';
  if (min !== null && quantityOnHand < min) return 'LOW';
  if (max !== null && quantityOnHand > max) return 'HIGH';
  return 'NORMAL';
}

@Injectable()
export class StockBalanceService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly stockBalanceRepository: StockBalanceRepository,
    private readonly inventoryBatchRepository: InventoryBatchRepository,
    private readonly drugRepository: DrugRepository,
    private readonly warehouseRepository: WarehouseRepository,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
  ) {}

  /** "Tồn kho" (view "Theo mặt hàng") — tổng hợp theo (drug, warehouse), gộp mọi lô. */
  async list(tenantId: string, query: ListStockBalancesQuery): Promise<ListStockBalancesResponse> {
    const { aggregated, drugById, warehouseById } = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const aggregated = await this.stockBalanceRepository.listAggregated(tx, tenantId, query.warehouseId);
      const drugs = await this.drugRepository.findByIds(tx, tenantId, [...new Set(aggregated.map((a) => a.drugId))]);
      const warehouses = await this.warehouseRepository.list(tx, tenantId);
      return {
        aggregated,
        drugById: new Map(drugs.map((d) => [d.id, d])),
        warehouseById: new Map(warehouses.map((w) => [w.id, w])),
      };
    });

    let items: StockBalanceItem[] = aggregated
      .map((row): StockBalanceItem | null => {
        const drug = drugById.get(row.drugId);
        const warehouse = warehouseById.get(row.warehouseId);
        if (!drug || !warehouse) return null;
        return {
          drugId: drug.id,
          drugCode: drug.code,
          drugName: drug.name,
          itemType: drug.itemType,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          unitCode: drug.baseUnitCode,
          quantityOnHand: row.quantityOnHand,
          minStockAlert: drug.minStockAlert,
          maxStockAlert: drug.maxStockAlert,
          status: resolveStatus(row.quantityOnHand, drug.minStockAlert, drug.maxStockAlert),
        };
      })
      .filter((i): i is StockBalanceItem => i !== null);

    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter((i) => i.drugName.toLowerCase().includes(q) || i.drugCode.toLowerCase().includes(q));
    }
    if (query.belowMinOnly) {
      items = items.filter((i) => i.status === 'LOW' || i.status === 'OUT');
    }
    items.sort((a, b) => a.drugName.localeCompare(b.drugName, 'vi'));

    return { items };
  }

  /** "Tồn kho theo lô" (panel chi tiết thuốc) — 1 thuốc, mọi lô còn tồn. */
  async getForDrug(tenantId: string, drugId: string, warehouseId?: string): Promise<GetDrugBatchBalancesResponse> {
    const [rows, expiryWarningDays] = await Promise.all([
      this.unitOfWork.runInTenantScope(tenantId, (tx) => this.inventoryBatchRepository.listWithBalanceForDrug(tx, tenantId, drugId, warehouseId)),
      this.clinicConfigReader.getExpiryWarningDays(tenantId),
    ]);
    const today = toVietnamDateParts(new Date());
    const todayUtcMs = Date.UTC(today.year, today.month - 1, today.day);
    const items = rows.map((r) => {
      const expiry = r.expiryDate ? computeExpiryStatus(r.expiryDate, todayUtcMs, expiryWarningDays) : null;
      return {
        batchId: r.batchId,
        batchNo: r.batchNo,
        warehouseId: r.warehouseId,
        warehouseName: r.warehouseName,
        expiryDate: r.expiryDate ? r.expiryDate.toISOString().slice(0, 10) : null,
        quantityOnHand: r.quantityOnHand,
        unitCost: Number(r.unitCost),
        expiryStatus: expiry?.status ?? null,
        daysUntilExpiry: expiry?.daysUntilExpiry ?? null,
      };
    });
    return { items, totalQuantityOnHand: items.reduce((sum, i) => sum + i.quantityOnHand, 0) };
  }

  /** "Cảnh báo hạn dùng" — mọi lô còn tồn, hạn dùng trong ngưỡng `expiryWarningDays` tới hoặc đã
   * hết hạn. Ngưỡng đọc theo tenant qua `ClinicConfigReaderPort` (`tenant_setting.expiry_warning_days`,
   * mặc định 30 — đọc/ghi qua `GET/PATCH /clinic-settings`). */
  async listExpiryWarnings(tenantId: string, query: ListStockExpiryWarningsQuery): Promise<ListStockExpiryWarningsResponse> {
    const expiryWarningDays = await this.clinicConfigReader.getExpiryWarningDays(tenantId);
    const today = toVietnamDateParts(new Date());
    const thresholdMs = Date.UTC(today.year, today.month - 1, today.day) + expiryWarningDays * 24 * 60 * 60 * 1000;
    const threshold = new Date(thresholdMs);

    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.inventoryBatchRepository.listExpiryWarnings(tx, tenantId, threshold, query.warehouseId));
    const todayMs = Date.UTC(today.year, today.month - 1, today.day);

    let expiringSoonCount = 0;
    let expiredCount = 0;
    const items = rows.map((r) => {
      // Repository đã lọc sẵn theo `threshold` nên `computeExpiryStatus` luôn trả kết quả (không null).
      const expiry = computeExpiryStatus(r.expiryDate, todayMs, expiryWarningDays)!;
      if (expiry.status === 'EXPIRED') expiredCount += 1;
      else expiringSoonCount += 1;
      return {
        batchId: r.batchId,
        batchNo: r.batchNo,
        drugId: r.drugId,
        drugName: r.drugName,
        warehouseId: r.warehouseId,
        warehouseName: r.warehouseName,
        expiryDate: r.expiryDate.toISOString().slice(0, 10),
        daysUntilExpiry: expiry.daysUntilExpiry,
        quantityOnHand: r.quantityOnHand,
        status: expiry.status,
      };
    });

    return { items, expiringSoonCount, expiredCount };
  }
}
