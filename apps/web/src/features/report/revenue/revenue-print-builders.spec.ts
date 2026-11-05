import { describe, expect, it } from 'vitest';
import type { RevenueByCashierReport, RevenueByPeriodReport, RevenueByServiceReport, RevenueUnpaidReport } from '@nexamed/shared';
import { buildRevenueByCashierPrintSpec, buildRevenueByMethodPrintSpec, buildRevenueByPeriodPrintSpec, buildRevenueByServicePrintSpec, buildRevenueUnpaidPrintSpec } from './revenue-print-builders';

const header = { generatedAt: '2026-11-05T08:00:00.000Z', from: '2026-09-01', to: '2026-10-31', branchCount: 1 };
const ctx = { from: '2026-09-01', to: '2026-10-31', scopeLabel: null };
const groups = { EXAM: 100, PARACLINICAL: 50, DRUG: 30, PACKAGE: 20 };

describe('bản in Doanh thu', () => {
  it('Theo kỳ: tiêu đề, kỳ, cột theo nhóm, dòng cộng và mức thay đổi', () => {
    const report: RevenueByPeriodReport = {
      ...header,
      groupBy: 'month',
      rows: [
        { key: '2026-09-01', label: 'T9/2026', byGroup: groups, recognized: 200, discount: 10, refunded: 5, collected: 100, net: 95, netDeltaPercent: null },
        { key: '2026-10-01', label: 'T10/2026', byGroup: groups, recognized: 200, discount: 0, refunded: 0, collected: 104, net: 104, netDeltaPercent: 9.5 },
      ],
      totals: { byGroup: { EXAM: 200, PARACLINICAL: 100, DRUG: 60, PACKAGE: 40 }, recognized: 400, discount: 10, refunded: 5, collected: 204, net: 199 },
    };
    const spec = buildRevenueByPeriodPrintSpec(report, ctx);
    expect(spec.title).toBe('Doanh thu theo kỳ');
    expect(spec.subtitleLines).toEqual(['Từ 01/09/2026 đến 31/10/2026', 'Gom theo: Tháng']);
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).toEqual(['Tháng', 'Khám bệnh', 'Cận lâm sàng', 'Thuốc và vật tư', 'Gói dịch vụ', 'Tổng ghi nhận', 'Chiết khấu', 'Hoàn tiền', 'Thực thu', 'So kỳ trước']);
    expect(section.rows[1]).toEqual(['T10/2026', '100', '50', '30', '20', '200', '0', '0', '104', '▲ 9,5%']);
    expect(section.rows[0]![9]).toBe('—');
    expect(section.totalRows![0]).toEqual(['Cộng', '200', '100', '60', '40', '400', '10', '5', '199', '']);
    expect(spec.infoLines![0]).toContain('Chênh lệch: 201');
  });

  it('phạm vi nhiều chi nhánh được ghi ở phụ đề', () => {
    const spec = buildRevenueByMethodPrintSpec({ ...header, rows: [], totals: { paymentCount: 0, collected: 0, refundCount: 0, refunded: 0, net: 0 } }, { ...ctx, scopeLabel: 'Quận 1, Quận 7' });
    expect(spec.subtitleLines).toContain('Phạm vi: Quận 1, Quận 7');
    expect(spec.sections[0]!.emptyText).toBeTruthy();
  });

  it('Theo dịch vụ: ghi chú khi danh sách bị cắt', () => {
    const report: RevenueByServiceReport = {
      ...header,
      totalAmount: 300,
      groups: [{ group: 'EXAM', quantity: 3, amount: 300, sharePercent: 100 }],
      rows: [{ group: 'EXAM', code: 'KHAM', name: 'Khám nội', quantity: 3, invoiceCount: 3, amount: 300, sharePercent: 100 }],
      rowTotal: 5,
    };
    const spec = buildRevenueByServicePrintSpec(report, ctx);
    expect(spec.note).toContain('1 dịch vụ');
    expect(spec.sections[1]!.rows[0]).toEqual(['Khám bệnh', 'Khám nội', '3', '3', '300', '100%']);
    expect(buildRevenueByServicePrintSpec({ ...report, rowTotal: 1 }, ctx).note).toBeUndefined();
  });

  it('Phiếu chưa thu: cột Chi nhánh chỉ khi gộp từ hai chi nhánh', () => {
    const report: RevenueUnpaidReport = {
      ...header,
      totalCount: 1,
      totalAmount: 500,
      oldestAgeDays: 0,
      aging: [{ label: 'Trong ngày', invoiceCount: 1, amount: 500 }],
      rows: [{ invoiceId: '00000000-0000-4000-8000-000000000001', invoiceNo: 'PT-1', invoiceType: 'SERVICE', patientCode: 'BN-1', patientName: 'An', date: '2026-10-05', ageDays: 0, branchId: '00000000-0000-4000-8000-000000000002', branchName: 'Quận 7', amount: 500 }],
    };
    expect(buildRevenueUnpaidPrintSpec(report, ctx).sections[1]!.columns.map((c) => c.header)).not.toContain('Chi nhánh');
    const multi = buildRevenueUnpaidPrintSpec({ ...report, branchCount: 2 }, ctx);
    expect(multi.sections[1]!.columns.map((c) => c.header)).toContain('Chi nhánh');
    expect(multi.sections[1]!.rows[0]).toContain('Quận 7');
    expect(multi.sections[1]!.rows[0]).toContain('An (BN-1)');
  });

  it('Theo thu ngân: ca đang mở chưa có số dự kiến hiện "—"', () => {
    const report: RevenueByCashierReport = {
      ...header,
      cashiers: [{ userId: '00000000-0000-4000-8000-000000000001', name: 'Thu ngân A', shiftCount: 1, paymentCount: 2, collected: 100, refunded: 10, net: 90, discrepancy: -5, discrepancyShiftCount: 1 }],
      totals: { shiftCount: 1, collected: 100, refunded: 10, net: 90, discrepancy: -5, discrepancyShiftCount: 1 },
      shifts: [{ shiftNo: 'PCC-1', label: 'Ca sáng', cashierName: 'Thu ngân A', branchId: '00000000-0000-4000-8000-000000000002', branchName: 'Quận 1', openedAt: '2026-09-11T01:00:00.000Z', closedAt: null, status: 'OPEN', expectedCash: null, countedCash: null, discrepancy: null }],
      shiftTotal: 1,
    };
    const spec = buildRevenueByCashierPrintSpec(report, ctx);
    expect(spec.sections[0]!.totalRows![0]).toEqual(['Cộng', '1', '100', '10', '90', '-5', '1']);
    expect(spec.sections[1]!.rows[0]).toEqual(['PCC-1', 'Thu ngân A', '11/09/2026 08:00', 'Đang mở', '—', '—', '—']);
  });
});
