import type { StockLedgerReportItem } from '@nexamed/shared';

/** 1 dòng hiển thị của báo cáo Nhập-Xuất-Tồn: hoặc 1 mặt hàng ở 1 kho, hoặc (khi gộp) 1 mặt hàng cộng các kho trong phạm vi. */
export interface StockLedgerDisplayRow {
  key: string;
  drugCode: string;
  drugName: string;
  unitCode: string | null;
  /** `null` khi dòng đã gộp nhiều chi nhánh — hiện `branchLabel` dạng chữ thay vì nhãn chi nhánh. */
  branchId: string | null;
  branchLabel: string;
  warehouseLabel: string;
  openingQuantity: number;
  totalIn: number;
  totalOut: number;
  closingQuantity: number;
}

/**
 * Dòng hiển thị của báo cáo Nhập-Xuất-Tồn (Đợt 3 chi nhánh, #235). `gather=false`: mỗi dòng API là một dòng hiển thị (mặt hàng × kho, đối chiếu từng kho).
 * `gather=true` ("Gộp theo mặt hàng"): cộng mọi kho thành MỘT dòng mỗi mặt hàng — số lượng chỉ cộng được vì cùng mặt hàng có cùng đơn vị cơ sở ở mọi kho.
 */
export function toStockLedgerDisplayRows(items: readonly StockLedgerReportItem[], gather: boolean): StockLedgerDisplayRow[] {
  if (!gather) {
    return items.map((i) => ({
      key: `${i.drugId}:${i.warehouseId}`,
      drugCode: i.drugCode,
      drugName: i.drugName,
      unitCode: i.unitCode,
      branchId: i.branchId,
      branchLabel: i.branchName,
      warehouseLabel: i.warehouseName,
      openingQuantity: i.openingQuantity,
      totalIn: i.totalIn,
      totalOut: i.totalOut,
      closingQuantity: i.closingQuantity,
    }));
  }

  const byDrug = new Map<string, { first: StockLedgerReportItem; warehouses: Set<string>; branches: Set<string>; opening: number; totalIn: number; totalOut: number }>();
  for (const i of items) {
    let bucket = byDrug.get(i.drugId);
    if (!bucket) {
      bucket = { first: i, warehouses: new Set(), branches: new Set(), opening: 0, totalIn: 0, totalOut: 0 };
      byDrug.set(i.drugId, bucket);
    }
    bucket.warehouses.add(i.warehouseId);
    bucket.branches.add(i.branchId);
    bucket.opening += i.openingQuantity;
    bucket.totalIn += i.totalIn;
    bucket.totalOut += i.totalOut;
  }
  return [...byDrug.entries()].map(([drugId, b]) => ({
    key: drugId,
    drugCode: b.first.drugCode,
    drugName: b.first.drugName,
    unitCode: b.first.unitCode,
    branchId: b.branches.size === 1 ? b.first.branchId : null,
    branchLabel: b.branches.size === 1 ? b.first.branchName : `${b.branches.size} chi nhánh`,
    warehouseLabel: b.warehouses.size === 1 ? b.first.warehouseName : `${b.warehouses.size} kho`,
    openingQuantity: b.opening,
    totalIn: b.totalIn,
    totalOut: b.totalOut,
    closingQuantity: b.opening + b.totalIn - b.totalOut,
  }));
}
