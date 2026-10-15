import { describe, expect, it } from 'vitest';
import type { StockLedgerReportItem } from '@nexamed/shared';
import { toStockLedgerDisplayRows } from './stock-ledger-rows';

const item = (over: Partial<StockLedgerReportItem>): StockLedgerReportItem => ({
  drugId: 'd1',
  drugCode: 'T0001',
  drugName: 'Paracetamol 500mg',
  unitCode: 'Viên',
  warehouseId: 'w1',
  warehouseName: 'Kho chính',
  branchId: 'b1',
  branchName: 'Cơ sở Quận 1',
  openingQuantity: 0,
  totalIn: 0,
  totalOut: 0,
  closingQuantity: 0,
  ...over,
});

describe('toStockLedgerDisplayRows', () => {
  const items = [
    item({ warehouseId: 'w1', branchId: 'b1', openingQuantity: 4200, totalIn: 3000, totalOut: 2750, closingQuantity: 4450 }),
    item({ warehouseId: 'w2', warehouseName: 'Kho Thủ Đức', branchId: 'b2', branchName: 'Cơ sở Thủ Đức', openingQuantity: 2600, totalIn: 2000, totalOut: 1980, closingQuantity: 2620 }),
    item({ drugId: 'd2', drugCode: 'T0014', drugName: 'Amoxicillin 500mg', warehouseId: 'w1', branchId: 'b1', openingQuantity: 3100, totalIn: 2000, totalOut: 2310, closingQuantity: 2790 }),
  ];

  it('không gộp: giữ nguyên từng dòng mặt hàng × kho', () => {
    const rows = toStockLedgerDisplayRows(items, false);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ key: 'd1:w2', branchId: 'b2', branchLabel: 'Cơ sở Thủ Đức', warehouseLabel: 'Kho Thủ Đức', closingQuantity: 2620 });
  });

  it('gộp: cộng các kho thành một dòng mỗi mặt hàng và tính lại cuối kỳ', () => {
    const rows = toStockLedgerDisplayRows(items, true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: 'd1', branchId: null, branchLabel: '2 chi nhánh', warehouseLabel: '2 kho', openingQuantity: 6800, totalIn: 5000, totalOut: 4730, closingQuantity: 7070 });
  });

  it('gộp: mặt hàng chỉ ở một kho giữ nhãn chi nhánh/kho gốc', () => {
    const rows = toStockLedgerDisplayRows(items, true);
    expect(rows[1]).toMatchObject({ key: 'd2', branchId: 'b1', branchLabel: 'Cơ sở Quận 1', warehouseLabel: 'Kho chính', closingQuantity: 2790 });
  });

  it('danh sách rỗng', () => {
    expect(toStockLedgerDisplayRows([], true)).toEqual([]);
    expect(toStockLedgerDisplayRows([], false)).toEqual([]);
  });
});
