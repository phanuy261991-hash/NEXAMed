import { describe, expect, it } from 'vitest';
import type { DoctorHoursReport, DoctorOrderMixReport, DoctorPerformanceReport } from '@nexamed/shared';
import { buildDoctorHoursPrintSpec, buildDoctorOrderMixPrintSpec, buildDoctorPerformancePrintSpec } from './doctors-print-builders';

const header = { generatedAt: '2026-11-05T08:00:00.000Z', from: '2026-10-01', to: '2026-10-31', branchCount: 1 };
const ctx = { from: '2026-10-01', to: '2026-10-31', scopeLabel: null, departmentLabel: null };
const id = '00000000-0000-4000-8000-000000000001';

describe('bản in Bác sĩ', () => {
  it('Hiệu suất: tiêu đề, kỳ, Khoa đang lọc, dòng cộng và "—" khi chưa đo được', () => {
    const report: DoctorPerformanceReport = {
      ...header,
      rows: [{ doctorId: id, doctorName: 'BS. An', departmentId: null, departmentName: 'Nội', rank: 1, visits: 10, avgMinutes: null, revenue: 3_000_000, revenuePerVisit: 300_000, clsPercent: 50, drugPercent: 33.3, followUpPercent: 0 }],
      totals: { doctorCount: 1, visits: 10, visitsPerDoctor: 10, avgMinutes: null, revenue: 3_000_000, revenuePerVisit: 300_000, clsPercent: 50, drugPercent: 33.3, followUpPercent: 0 },
    };
    const spec = buildDoctorPerformancePrintSpec(report, { ...ctx, departmentLabel: 'Khoa Nội', scopeLabel: 'Quận 1, Quận 7' });
    expect(spec.title).toBe('Hiệu suất theo bác sĩ');
    expect(spec.subtitleLines).toEqual(['Từ 01/10/2026 đến 31/10/2026', 'Phạm vi: Quận 1, Quận 7', 'Khoa: Khoa Nội']);
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).toEqual(['#', 'Bác sĩ', 'Khoa', 'Lượt khám', 'Phút / lượt', 'Doanh thu sinh ra', 'Một lượt', 'Có CLS', 'Có thuốc', 'Hẹn tái khám']);
    expect(section.rows[0]).toEqual(['1', 'BS. An', 'Nội', '10', '—', '3.000.000', '300.000', '50%', '33,3%', '0%']);
    expect(section.totalRows![0]![1]).toBe('Cộng 1 bác sĩ');
  });

  it('không lọc Khoa và một chi nhánh: phụ đề chỉ có kỳ', () => {
    const empty: DoctorPerformanceReport = { ...header, rows: [], totals: { doctorCount: 0, visits: 0, visitsPerDoctor: null, avgMinutes: null, revenue: 0, revenuePerVisit: null, clsPercent: null, drugPercent: null, followUpPercent: null } };
    const spec = buildDoctorPerformancePrintSpec(empty, ctx);
    expect(spec.subtitleLines).toEqual(['Từ 01/10/2026 đến 31/10/2026']);
    expect(spec.sections[0]!.emptyText).toBeTruthy();
  });

  it('Cơ cấu: có đủ ba khối (theo bác sĩ, thuốc nhiều nhất, chỉ định nhiều nhất)', () => {
    const report: DoctorOrderMixReport = {
      ...header,
      rows: [{ doctorId: id, doctorName: 'BS. An', departmentId: null, departmentName: '', visits: 10, withPrescription: 8, prescriptionItems: 20, itemsPerPrescription: 2.5, withCls: 4, clsInHouse: 5, clsExternal: 2, withFollowUp: 3 }],
      totals: { visits: 10, withPrescription: 8, prescriptionItems: 20, itemsPerPrescription: 2.5, withCls: 4, clsInHouse: 5, clsExternal: 2, withFollowUp: 3 },
      topDrugs: [{ name: 'Paracetamol', count: 12, doctorCount: 2 }],
      topOrders: [],
    };
    const spec = buildDoctorOrderMixPrintSpec(report, ctx);
    expect(spec.sections.map((s) => s.title)).toEqual(['Theo bác sĩ', 'Thuốc kê nhiều nhất', 'Chỉ định cận lâm sàng nhiều nhất']);
    expect(spec.sections[0]!.rows[0]).toEqual(['BS. An', '', '10', '8', '20', '2,5', '4', '5', '2', '3']);
    expect(spec.sections[1]!.rows[0]).toEqual(['1', 'Paracetamol', '12', '2']);
    expect(spec.sections[2]!.rows).toEqual([]);
    expect(spec.sections[2]!.emptyText).toBeTruthy();
  });

  it('Giờ làm việc: thời lượng giờ/phút, bác sĩ không có ca hiện "—" ở tỉ lệ sử dụng', () => {
    const report: DoctorHoursReport = {
      ...header,
      rows: [{ doctorId: id, doctorName: 'BS. An', departmentId: null, departmentName: 'Nội', scheduledDays: 0, scheduledMinutes: 0, leaveDays: 1, leaveMinutes: 240, activeDays: 2, visits: 6, visitsPerActiveDay: 3, consultMinutes: 125, utilizationPercent: null }],
      totals: { doctorCount: 1, scheduledDays: 0, scheduledMinutes: 0, leaveDays: 1, leaveMinutes: 240, activeDays: 2, visits: 6, consultMinutes: 125, utilizationPercent: null },
    };
    const spec = buildDoctorHoursPrintSpec(report, ctx);
    expect(spec.sections[0]!.rows[0]).toEqual(['BS. An', 'Nội', '0', '0 phút', '1 ngày', '2', '6', '3', '2 giờ 05 phút', '—']);
    expect(spec.infoLines![0]).toContain('Nghỉ phép: 1 ngày');
  });
});
