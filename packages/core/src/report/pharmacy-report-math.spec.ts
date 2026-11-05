import { describe, expect, it } from 'vitest';
import { createMarginAccumulator, marginPercentOf, type MarginDrugInfo, type MarginInvoiceLine } from './pharmacy-report-math';

const para: MarginDrugInfo = { drugId: 'd1', code: 'PARA', name: 'Paracetamol 500mg', itemType: 'MEDICINE', unitCode: 'VIEN' };
const glove: MarginDrugInfo = { drugId: 'd2', code: 'GANG', name: 'Găng tay y tế', itemType: 'SUPPLY', unitCode: 'DOI' };

const drugLine = (drug: MarginDrugInfo, quantity: number, unitPrice: number, unitCost: number, extra: Partial<MarginInvoiceLine> = {}): MarginInvoiceLine => ({
  lineTotal: quantity * unitPrice,
  discountType: null,
  discountValue: null,
  drug,
  quantity,
  unitCost,
  refundedQuantity: 0,
  refundedAmount: 0,
  restockedQuantity: 0,
  ...extra,
});
const examLine = (lineTotal: number): MarginInvoiceLine => ({ lineTotal, discountType: null, discountValue: null, drug: null, quantity: 1, unitCost: 0, refundedQuantity: 0, refundedAmount: 0, restockedQuantity: 0 });
const invoice = (lines: MarginInvoiceLine[], discountType: 'PERCENT' | 'AMOUNT' | null = null, discountValue: number | null = null) => ({
  totalAmount: lines.reduce((s, l) => s + l.lineTotal, 0),
  discountType,
  discountValue,
  lines,
});

describe('marginPercentOf', () => {
  it('làm tròn một chữ số thập phân; tiền bán không dương thì không có biên', () => {
    expect(marginPercentOf(96_480_000, 172_250_000)).toBe(56);
    expect(marginPercentOf(1, 3)).toBe(33.3);
    expect(marginPercentOf(0, 0)).toBeNull();
    expect(marginPercentOf(-5, -10)).toBeNull();
  });
});

describe('createMarginAccumulator', () => {
  it('tiền bán trừ giá vốn theo mặt hàng, xếp theo lãi gộp giảm dần', () => {
    const acc = createMarginAccumulator();
    acc.addInvoices([invoice([drugLine(para, 100, 1000, 500), drugLine(glove, 10, 2000, 1300)])]);
    acc.addInvoices([invoice([drugLine(para, 50, 1000, 500)])]);
    const { rows, totals } = acc.finish();
    expect(rows.map((r) => r.code)).toEqual(['PARA', 'GANG']);
    expect(rows[0]).toMatchObject({ quantity: 150, sell: 150_000, cost: 75_000, margin: 75_000, marginPercent: 50 });
    expect(rows[1]).toMatchObject({ quantity: 10, sell: 20_000, cost: 13_000, margin: 7_000, marginPercent: 35 });
    expect(totals).toEqual({ sell: 170_000, cost: 88_000, margin: 82_000, marginPercent: 48.2, itemCount: 2 });
  });

  it('dòng dịch vụ không vào báo cáo nhưng vẫn chia chiết khấu toàn phiếu: tổng tiền bán thuốc là phần của dueAmount', () => {
    const acc = createMarginAccumulator();
    // Tổng 400.000 (khám 300.000 + thuốc 100.000), giảm 10% = 360.000 → thuốc nhận 90.000.
    acc.addInvoices([invoice([examLine(300_000), drugLine(para, 100, 1000, 400)], 'PERCENT', 10)]);
    const { rows } = acc.finish();
    expect(rows[0]).toMatchObject({ sell: 90_000, cost: 40_000, margin: 50_000 });
  });

  it('phiếu không có dòng thuốc bị bỏ qua', () => {
    const acc = createMarginAccumulator();
    acc.addInvoices([invoice([examLine(300_000)])]);
    expect(acc.finish()).toEqual({ rows: [], totals: { sell: 0, cost: 0, margin: 0, marginPercent: null, itemCount: 0 } });
  });

  it('hoàn một phần: trừ tiền đã hoàn; hàng nhập lại kho trả giá vốn, hàng không nhập lại thì giữ vốn', () => {
    const restocked = createMarginAccumulator();
    restocked.addInvoices([invoice([drugLine(para, 100, 1000, 500, { refundedQuantity: 20, refundedAmount: 20_000, restockedQuantity: 20 })])]);
    expect(restocked.finish().rows[0]).toMatchObject({ quantity: 80, sell: 80_000, cost: 40_000, margin: 40_000 });

    const lost = createMarginAccumulator();
    lost.addInvoices([invoice([drugLine(para, 100, 1000, 500, { refundedQuantity: 20, refundedAmount: 20_000, restockedQuantity: 0 })])]);
    expect(lost.finish().rows[0]).toMatchObject({ quantity: 80, sell: 80_000, cost: 50_000, margin: 30_000 });
  });

  it('lọc theo Loại: tổng và dòng chỉ gồm loại đang xem', () => {
    const lines = [drugLine(para, 10, 1000, 400), drugLine(glove, 10, 2000, 1000)];
    const medicine = createMarginAccumulator('MEDICINE');
    medicine.addInvoices([invoice(lines)]);
    expect(medicine.finish().rows.map((r) => r.code)).toEqual(['PARA']);
    expect(medicine.finish().totals.sell).toBe(10_000);

    const supply = createMarginAccumulator('SUPPLY');
    supply.addInvoices([invoice(lines)]);
    expect(supply.finish().rows.map((r) => r.code)).toEqual(['GANG']);
    expect(supply.finish().totals.sell).toBe(20_000);
  });

  it('chiết khấu từng dòng chỉ giảm đúng dòng đó', () => {
    const acc = createMarginAccumulator();
    acc.addInvoices([invoice([drugLine(para, 10, 1000, 400, { discountType: 'PERCENT', discountValue: 50 }), drugLine(glove, 10, 2000, 1000)])]);
    const byCode = Object.fromEntries(acc.finish().rows.map((r) => [r.code, r]));
    expect(byCode['PARA']!.sell).toBe(5_000);
    expect(byCode['GANG']!.sell).toBe(20_000);
  });

  it('lỗ gộp (bán dưới vốn) cho lãi gộp âm và vẫn xếp cuối', () => {
    const acc = createMarginAccumulator();
    acc.addInvoices([invoice([drugLine(para, 10, 300, 500), drugLine(glove, 10, 2000, 1000)])]);
    const { rows, totals } = acc.finish();
    expect(rows.map((r) => r.code)).toEqual(['GANG', 'PARA']);
    expect(rows[1]!.margin).toBe(-2_000);
    expect(totals.margin).toBe(8_000);
  });
});
