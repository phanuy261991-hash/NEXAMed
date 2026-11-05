import { describe, expect, it } from 'vitest';
import type { InvoiceLineSource } from './dashboard-math';
import { splitIntoMonthChunks, createRevenuePeriodAccumulator, createServiceBreakdownAccumulator, recognizeInvoice, revenueBucketKey, revenueBucketKeys, revenueBucketLabel, sharePercent } from './revenue-report-math';

const none: InvoiceLineSource = { sourceServiceItemId: null, sourceStockIssueLineId: null, sourceOrderItemId: null, sourceOrderPackageId: null };
const exam = { ...none, sourceServiceItemId: 'x' };
const drug = { ...none, sourceStockIssueLineId: 'x' };
const cls = { ...none, sourceOrderItemId: 'x' };
const pkg = { ...none, sourceOrderPackageId: 'x' };

describe('khoảng gom theo kỳ', () => {
  it('ngày/tuần/tháng/quý trả về ngày đầu khoảng', () => {
    expect(revenueBucketKey('2026-11-05', 'day')).toBe('2026-11-05');
    // 05/11/2026 là thứ Năm → thứ Hai cùng tuần là 02/11.
    expect(revenueBucketKey('2026-11-05', 'week')).toBe('2026-11-02');
    // Chủ nhật 08/11 vẫn thuộc tuần bắt đầu thứ Hai 02/11; thứ Hai 09/11 sang tuần mới.
    expect(revenueBucketKey('2026-11-08', 'week')).toBe('2026-11-02');
    expect(revenueBucketKey('2026-11-09', 'week')).toBe('2026-11-09');
    expect(revenueBucketKey('2026-11-05', 'month')).toBe('2026-11-01');
    expect(revenueBucketKey('2026-11-05', 'quarter')).toBe('2026-10-01');
    expect(revenueBucketKey('2026-03-31', 'quarter')).toBe('2026-01-01');
  });

  it('liệt kê đủ khoảng gom, kể cả tuần cắt ngang qua tháng và qua năm', () => {
    expect(revenueBucketKeys('2026-01-01', '2026-04-15', 'month')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    expect(revenueBucketKeys('2026-12-30', '2027-01-04', 'week')).toEqual(['2026-12-28', '2027-01-04']);
    expect(revenueBucketKeys('2026-01-01', '2026-12-31', 'quarter')).toHaveLength(4);
    expect(revenueBucketKeys('2026-11-05', '2026-11-05', 'day')).toEqual(['2026-11-05']);
  });

  it('nhãn khoảng gom', () => {
    expect(revenueBucketLabel('2026-11-05', 'day')).toBe('05/11/2026');
    expect(revenueBucketLabel('2026-11-02', 'week')).toBe('02/11 – 08/11');
    expect(revenueBucketLabel('2026-10-01', 'month')).toBe('T10/2026');
    expect(revenueBucketLabel('2026-10-01', 'quarter')).toBe('Q4/2026');
  });
});

describe('recognizeInvoice', () => {
  it('chia số sau chiết khấu vào 4 nhóm, tổng đúng bằng dueAmount', () => {
    const r = recognizeInvoice({
      totalAmount: 1_000_000,
      discountType: 'PERCENT',
      discountValue: 10,
      lines: [
        { ...exam, lineTotal: 300_000, discountType: null, discountValue: null },
        { ...cls, lineTotal: 300_000, discountType: null, discountValue: null },
        { ...drug, lineTotal: 300_001, discountType: null, discountValue: null },
        { ...pkg, lineTotal: 99_999, discountType: null, discountValue: null },
      ],
    });
    expect(r.gross).toBe(1_000_000);
    expect(r.discount).toBe(100_000);
    expect(r.due).toBe(900_000);
    expect(r.byGroup.EXAM + r.byGroup.PARACLINICAL + r.byGroup.DRUG + r.byGroup.PACKAGE).toBe(900_000);
  });

  it('phiếu không có dòng dồn vào Khám bệnh', () => {
    const r = recognizeInvoice({ totalAmount: 200_000, discountType: null, discountValue: null, lines: [] });
    expect(r.byGroup.EXAM).toBe(200_000);
    expect(r.discount).toBe(0);
  });
});

describe('createRevenuePeriodAccumulator', () => {
  const invoice = (date: string, total: number, source: InvoiceLineSource = exam) => ({ date, totalAmount: total, discountType: null, discountValue: null, lines: [{ ...source, lineTotal: total, discountType: null, discountValue: null }] });

  it('Ghi nhận theo ngày khám, Thực thu theo ngày thu, hai cột độc lập', () => {
    const acc = createRevenuePeriodAccumulator('2026-09-01', '2026-10-31', 'month');
    acc.addInvoices([invoice('2026-09-30', 500_000), invoice('2026-10-01', 300_000, drug)]);
    // Phiếu khám 30/09 thu sang 01/10; hoàn 50.000 ở tháng 10.
    acc.addPayments([
      { date: '2026-10-01', type: 'PAYMENT', amount: 800_000 },
      { date: '2026-10-15', type: 'REFUND', amount: 50_000 },
    ]);
    const { rows, totals } = acc.finish();
    expect(rows.map((r) => r.label)).toEqual(['T9/2026', 'T10/2026']);
    expect(rows[0]).toMatchObject({ recognized: 500_000, collected: 0, net: 0, netDeltaPercent: null });
    expect(rows[1]).toMatchObject({ recognized: 300_000, collected: 800_000, refunded: 50_000, net: 750_000 });
    expect(rows[1]!.byGroup.DRUG).toBe(300_000);
    // Khoảng trước có Thực thu 0 → không chia được.
    expect(rows[1]!.netDeltaPercent).toBeNull();
    expect(totals).toMatchObject({ recognized: 800_000, net: 750_000, refunded: 50_000 });
  });

  it('so với khoảng liền trước và bỏ ngày ngoài kỳ', () => {
    const acc = createRevenuePeriodAccumulator('2026-10-01', '2026-11-30', 'month');
    acc.addPayments([
      { date: '2026-10-10', type: 'PAYMENT', amount: 1_000_000 },
      { date: '2026-11-10', type: 'PAYMENT', amount: 1_250_000 },
      { date: '2026-12-01', type: 'PAYMENT', amount: 9_999_999 },
      { date: '2026-09-30', type: 'PAYMENT', amount: 9_999_999 },
    ]);
    const { rows, totals } = acc.finish();
    expect(rows[1]!.netDeltaPercent).toBe(25);
    expect(totals.net).toBe(2_250_000);
  });

  it('gom theo ngày liệt kê đủ ngày kể cả ngày không có số', () => {
    const { rows } = createRevenuePeriodAccumulator('2026-11-01', '2026-11-03', 'day').finish();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.recognized === 0 && r.net === 0)).toBe(true);
  });
});

describe('createServiceBreakdownAccumulator', () => {
  it('cộng dồn theo (nhóm, mã, tên), sắp theo doanh thu giảm dần, tổng nhóm đúng', () => {
    const acc = createServiceBreakdownAccumulator();
    const line = (source: InvoiceLineSource, code: string, name: string, lineTotal: number, quantity = 1) => ({ ...source, code, name, quantity, lineTotal, discountType: null, discountValue: null });
    acc.addInvoices([
      { totalAmount: 300_000, discountType: null, discountValue: null, lines: [line(exam, 'KB', 'Khám', 200_000), line(drug, 'PARA', 'Paracetamol', 100_000, 10)] },
      { totalAmount: 200_000, discountType: null, discountValue: null, lines: [line(exam, 'KB', 'Khám', 200_000)] },
      { totalAmount: 0, discountType: null, discountValue: null, lines: [] },
    ]);
    const { rows, byGroup } = acc.finish();
    expect(rows.map((r) => [r.name, r.quantity, r.invoiceCount, r.amount])).toEqual([
      ['Khám', 2, 2, 400_000],
      ['Paracetamol', 10, 1, 100_000],
    ]);
    expect(byGroup.EXAM).toEqual({ quantity: 2, amount: 400_000 });
    expect(byGroup.DRUG).toEqual({ quantity: 10, amount: 100_000 });
  });

  it('chiết khấu toàn phiếu giảm đều doanh thu từng dịch vụ', () => {
    const acc = createServiceBreakdownAccumulator();
    acc.addInvoices([
      {
        totalAmount: 400_000,
        discountType: 'PERCENT',
        discountValue: 50,
        lines: [
          { ...exam, code: 'A', name: 'A', quantity: 1, lineTotal: 100_000, discountType: null, discountValue: null },
          { ...cls, code: 'B', name: 'B', quantity: 1, lineTotal: 300_000, discountType: null, discountValue: null },
        ],
      },
    ]);
    expect(acc.finish().rows.map((r) => [r.name, r.amount])).toEqual([['B', 150_000], ['A', 50_000]]);
  });
});

describe('sharePercent', () => {
  it('tính tỉ trọng, null khi mẫu số không dương', () => {
    expect(sharePercent(1, 3)).toBe(33.3);
    expect(sharePercent(5, 0)).toBeNull();
  });
});

describe('splitIntoMonthChunks', () => {
  it('cắt theo tháng lịch, đoạn đầu và cuối được tỉa theo kỳ', () => {
    expect(splitIntoMonthChunks('2026-01-15', '2026-03-10')).toEqual([
      { from: '2026-01-15', to: '2026-01-31' },
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-03-01', to: '2026-03-10' },
    ]);
    expect(splitIntoMonthChunks('2028-02-10', '2028-02-20')).toEqual([{ from: '2028-02-10', to: '2028-02-20' }]);
    expect(splitIntoMonthChunks('2026-12-20', '2027-01-05')).toEqual([
      { from: '2026-12-20', to: '2026-12-31' },
      { from: '2027-01-01', to: '2027-01-05' },
    ]);
  });
});
