import { describe, expect, it } from 'vitest';
import { buildCashBoxRows, buildHourlyChart, labelWithCount, pendingInvoiceHref } from './cashier-dashboard-model';

describe('labelWithCount', () => {
  it('thêm số phiếu khi có, bỏ khi bằng 0', () => {
    expect(labelWithCount('Chờ thu', 5)).toBe('Chờ thu · 5 phiếu');
    expect(labelWithCount('Đã hoàn', 0)).toBe('Đã hoàn');
  });
});

describe('pendingInvoiceHref', () => {
  it('mở đúng phiếu của lượt khám', () => {
    expect(pendingInvoiceHref({ encounterId: 'enc-1', invoiceId: 'inv-9' })).toBe('/billing/enc-1?invoiceId=inv-9');
  });
});

describe('buildCashBoxRows', () => {
  const summary = { cashInAmount: 12_800_000, cashOutAmount: 1_500_000, otherCashInAmount: 500_000, otherCashOutAmount: 1_150_000 };

  it('tách thu khám / phiếu thu khác và hoàn tiền / phiếu chi khác khỏi tổng gộp của máy chủ', () => {
    const rows = Object.fromEntries(buildCashBoxRows(2_000_000, summary).map((r) => [r.key, r.amount]));
    expect(rows).toEqual({ opening: 2_000_000, examIn: 12_300_000, otherIn: 500_000, otherOut: 1_150_000, refund: 350_000 });
  });

  it('vốn + dòng cộng − dòng trừ khớp tiền dự kiến của máy chủ (vốn + tổng thu − tổng chi)', () => {
    const rows = buildCashBoxRows(2_000_000, summary);
    const expected = rows.reduce((s, r) => s + (r.direction === 'minus' ? -r.amount : r.amount), 0);
    expect(expected).toBe(2_000_000 + summary.cashInAmount - summary.cashOutAmount);
  });
});

describe('buildHourlyChart', () => {
  const hourly = (entries: Record<number, number>) => Array.from({ length: 24 }, (_, hour) => ({ hour, amount: entries[hour] ?? 0 }));

  it('mặc định 07–18, đỉnh là giờ thu nhiều nhất, nhãn cột theo triệu', () => {
    const chart = buildHourlyChart(hourly({ 9: 2_100_000, 10: 3_400_000, 14: 2_600_000 }));
    expect(chart.items).toHaveLength(12);
    expect(chart.items[0]!.label).toBe('07');
    expect(chart.peakHour).toBe(10);
    expect(chart.peakAmount).toBe(3_400_000);
    expect(chart.items[chart.peakIndex!]!.valueLabel).toBe('3,4');
    expect(chart.total).toBe(8_100_000);
  });

  it('mở rộng khoảng giờ khi có tiền ngoài 07–18; hoà đỉnh lấy giờ sớm hơn', () => {
    const chart = buildHourlyChart(hourly({ 6: 500_000, 20: 500_000 }));
    expect(chart.items[0]!.label).toBe('06');
    expect(chart.items.at(-1)!.label).toBe('20');
    expect(chart.peakHour).toBe(6);
  });

  it('giờ thu ròng âm vẽ cột 0 nhưng tổng ngày vẫn tính số âm; ngày trống không có đỉnh', () => {
    const chart = buildHourlyChart(hourly({ 9: 400_000, 11: -50_000 }));
    expect(chart.items.find((i) => i.label === '11')!.value).toBe(0);
    expect(chart.total).toBe(350_000);
    expect(buildHourlyChart(hourly({})).peakIndex).toBeNull();
  });
});
