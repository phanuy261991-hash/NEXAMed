import { describe, expect, it } from 'vitest';
import type { SystemCrossReport, SystemMonthlyReport, SystemOverviewReport, SystemRankingReport } from '@nexamed/shared';
import { buildSystemCrossPrintSpec, buildSystemMonthlyPrintSpec, buildSystemOverviewPrintSpec, buildSystemRankingPrintSpec } from './system-print-builders';

const header = { generatedAt: '2026-11-05T08:00:00.000Z', from: '2026-10-01', to: '2026-10-31', branchCount: 2 };
const ctx = { from: '2026-10-01', to: '2026-10-31', scopeLabel: 'Quận 1, Quận 7' };
const a = '00000000-0000-4000-8000-00000000000a';
const b = '00000000-0000-4000-8000-00000000000b';
const kpi = (value: number, previous: number, percent: number | null) => ({ value, previous, percent, direction: (value > previous ? 'up' : value < previous ? 'down' : 'flat') as 'up' | 'down' | 'flat' });

describe('bản in Toàn hệ thống', () => {
  it('So sánh chi nhánh: tiêu đề, kỳ, phạm vi, kỳ trước, dòng cộng, cơ cấu và cần chú ý', () => {
    const report: SystemOverviewReport = {
      ...header,
      previousFrom: '2026-09-01',
      previousTo: '2026-09-30',
      kpis: { recognized: kpi(842_600_000, 777_300_000, 8.4), collected: kpi(791_350_000, 740_000_000, 6.9), visits: kpi(1284, 1220, 5.2), newPatients: kpi(312, 319, -2.1), unpaidAmount: 48_200_000, unpaidCount: 18 },
      rows: [
        { branchId: a, branchName: 'Quận 1', visits: 612, newPatients: 148, recognized: 410_200_000, collected: 388_600_000, unpaidAmount: 18_400_000, unpaidCount: 9, averageWaitMinutes: 14, followUpArrivalPercent: 74, drugMargin: 51_300_000 },
        { branchId: b, branchName: 'Quận 7', visits: 431, newPatients: 104, recognized: 276_900_000, collected: 259_300_000, unpaidAmount: 17_600_000, unpaidCount: 9, averageWaitMinutes: null, followUpArrivalPercent: null, drugMargin: 31_900_000 },
      ],
      totals: { visits: 1043, newPatients: 252, recognized: 687_100_000, collected: 647_900_000, unpaidAmount: 36_000_000, unpaidCount: 18, averageWaitMinutes: 14, followUpArrivalPercent: 74, drugMargin: 83_200_000 },
      daily: { dates: ['2026-10-01'], series: [] },
      groups: [
        { group: 'EXAM', amount: 400, sharePercent: 40 },
        { group: 'DRUG', amount: 600, sharePercent: 60 },
      ],
      groupTotal: 1000,
      alerts: [{ kind: 'OPEN_SHIFTS', branchId: a, branchName: 'Quận 1', text: '2 ca thu ngân chưa chốt từ hôm qua', count: 2 }],
    };
    const spec = buildSystemOverviewPrintSpec(report, ctx);
    expect(spec.title).toBe('Toàn hệ thống — So sánh chi nhánh');
    expect(spec.subtitleLines).toEqual(['Từ 01/10/2026 đến 31/10/2026', 'Phạm vi: Quận 1, Quận 7', 'So với kỳ trước: 01/09/2026 – 30/09/2026']);
    expect(spec.infoLines![0]).toContain('Ghi nhận: 842.600.000 (+8,4%)');
    expect(spec.infoLines![0]).toContain('Bệnh nhân mới: 312 (-2,1%)');
    const table = spec.sections[0]!;
    expect(table.columns.map((c) => c.header)).toEqual(['Chi nhánh', 'Lượt khám', 'BN mới', 'Ghi nhận', 'Thực thu', 'Chờ thu', 'Chờ TB (phút)', 'Tái khám đã đến', 'Lãi gộp thuốc']);
    expect(table.rows[0]).toEqual(['Quận 1', '612', '148', '410.200.000', '388.600.000', '18.400.000', '14', '74%', '51.300.000']);
    expect(table.rows[1]![6]).toBe('—');
    expect(table.rows[1]![7]).toBe('—');
    expect(table.totalRows![0]![0]).toBe('Cộng 2 chi nhánh');
    expect(spec.sections[1]!.rows[0]).toEqual(['Khám bệnh', '400', '40%']);
    expect(spec.sections[2]!.rows[0]).toEqual(['Quận 1', '2 ca thu ngân chưa chốt từ hôm qua']);
  });

  it('Xếp hạng: ba bảng, cột từng chi nhánh chỉ có khi gộp nhiều chi nhánh', () => {
    const rank = [{ key: 'k', name: 'Khám nội', subtitle: 'Khám bệnh', quantity: 5, total: 500, byBranch: [300, 200] }];
    const report: SystemRankingReport = { ...header, branches: [{ branchId: a, branchName: 'Quận 1' }, { branchId: b, branchName: 'Quận 7' }], services: rank, doctors: [], drugs: [] };
    const multi = buildSystemRankingPrintSpec(report, ctx);
    expect(multi.sections.map((s) => s.title)).toEqual(['Dịch vụ', 'Bác sĩ', 'Thuốc và vật tư']);
    expect(multi.sections[0]!.columns.map((c) => c.header)).toEqual(['Hạng', 'Tên', 'Nhóm', 'Số lượng', 'Ghi nhận', 'Quận 1', 'Quận 7']);
    expect(multi.sections[0]!.rows[0]).toEqual(['1', 'Khám nội', 'Khám bệnh', '5', '500', '300', '200']);
    expect(multi.sections[1]!.emptyText).toBe('Chưa có bác sĩ nào khám trong kỳ');
    const single = buildSystemRankingPrintSpec({ ...report, branches: [{ branchId: a, branchName: 'Quận 1' }], services: [{ ...rank[0]!, byBranch: [500] }] }, ctx);
    expect(single.sections[0]!.columns.map((c) => c.header)).toEqual(['Hạng', 'Tên', 'Nhóm', 'Số lượng', 'Ghi nhận']);
    expect(single.sections[0]!.rows[0]).toEqual(['1', 'Khám nội', 'Khám bệnh', '5', '500']);
  });

  it('Tổng hợp tháng: tiêu đề theo tháng, so với tháng trước, ba ô ký, xu hướng', () => {
    const m = (visits: number, collected: number) => ({ visits, newPatients: 1, recognized: collected, collected, drugMargin: 10 });
    const report: SystemMonthlyReport = {
      ...header,
      month: '2026-10',
      previousMonth: '2026-09',
      kpis: { recognized: kpi(200, 100, 100), collected: kpi(200, 100, 100), visits: kpi(20, 10, 100), newPatients: kpi(2, 1, 100), drugMargin: kpi(20, 10, 100) },
      rows: [{ branchId: a, branchName: 'Quận 1', current: m(10, 100), previous: m(5, 50) }, { branchId: b, branchName: 'Quận 7', current: m(10, 100), previous: m(5, 50) }],
      groups: [{ group: 'EXAM', amount: 200, sharePercent: 100 }],
      groupTotal: 200,
      trend: [{ month: '2026-09', visits: 10, newPatients: 1, recognized: 100, collected: 100 }, { month: '2026-10', visits: 20, newPatients: 2, recognized: 200, collected: 200 }],
    };
    const spec = buildSystemMonthlyPrintSpec(report, ctx);
    expect(spec.title).toBe('Toàn hệ thống — Tổng hợp tháng 10/2026');
    expect(spec.subtitleLines).toContain('So với tháng 09/2026');
    expect(spec.signatures).toEqual(['Người lập', 'Quản lý', 'Chủ phòng khám']);
    const table = spec.sections[0]!;
    expect(table.rows[0]).toEqual(['Quận 1', '10', '1', '100', '100', '50', '+100%', '10']);
    expect(table.totalRows![0]).toEqual(['Cộng 2 chi nhánh', '20', '2', '200', '200', '100', '+100%', '20']);
    expect(spec.sections[2]!.title).toBe('Xu hướng 2 tháng gần nhất');
    expect(spec.sections[2]!.rows[1]).toEqual(['10/2026', '20', '2', '200', '200']);
  });

  it('Khám chéo: hai bảng, không có cột tiền, ghi chú khi danh sách bị cắt', () => {
    const report: SystemCrossReport = {
      ...header,
      totals: { patientCount: 40, crossPatientCount: 6, crossPercent: 15, crossVisits: 14 },
      pairs: [{ branchAId: a, branchAName: 'Quận 1', branchBId: b, branchBName: 'Quận 7', patientCount: 6 }],
      rows: [{ patientId: a, patientCode: 'BN1', patientName: 'Nguyễn An', branchCount: 2, visitCount: 3, lastVisitDate: '2026-10-20', branches: [{ branchName: 'Quận 1', visits: 2 }, { branchName: 'Quận 7', visits: 1 }] }],
      rowTotal: 900,
    };
    const spec = buildSystemCrossPrintSpec(report, ctx);
    expect(spec.sections[0]!.rows[0]).toEqual(['Quận 1', 'Quận 7', '6']);
    expect(spec.sections[1]!.rows[0]).toEqual(['BN1', 'Nguyễn An', '2', '3', 'Quận 1 (2), Quận 7 (1)', '20/10/2026']);
    expect(spec.sections[1]!.columns.map((c) => c.header).join(' ')).not.toMatch(/tiền|thu|ghi nhận/i);
    expect(spec.infoLines!.join(' ')).toContain('không hiện tiền theo bệnh nhân');
    expect(spec.note).toContain('900');
  });
});
