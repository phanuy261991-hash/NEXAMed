import { describe, expect, it } from 'vitest';
import type { BookingSourceReport, CancellationReport, FollowUpReport, PeakHoursReport, VisitBookRow, WaitingReport } from '@nexamed/shared';
import {
  buildBookingSourcePrintSpec,
  buildCancellationPrintSpec,
  buildFollowUpPrintSpec,
  buildPeakHoursPrintSpec,
  buildVisitBookPrintSpec,
  buildWaitingPrintSpec,
} from './operations-print-builders';

const ctx = { from: '2026-10-01', to: '2026-10-31', scopeLabel: null };
const base = { generatedAt: '2026-11-05T07:00:00.000Z', from: '2026-10-01', to: '2026-10-31', branchCount: 1 };
const waiting = {
  measuredCount: 4,
  averageMinutes: 28,
  over30Count: 2,
  over30Percent: 50,
  slots: [{ label: '07–09h', visits: 3, averageMinutes: 17, over30Percent: 33.3 }],
  distribution: [{ label: '0–10 phút', count: 1, percent: 25 }],
};

describe('bản in Giờ cao điểm', () => {
  const report: PeakHoursReport = {
    ...base,
    hours: [7, 8, 9],
    days: [
      { isoDow: 1, counts: [0, 2, 5], total: 7 },
      { isoDow: 2, counts: [1, 0, 0], total: 1 },
    ],
    totalVisits: 8,
    peak: { isoDow: 1, hour: 9, count: 5 },
    quietestDay: { isoDow: 2, total: 1 },
    waiting,
  };
  const spec = buildPeakHoursPrintSpec(report, ctx);

  it('bảng thứ × giờ: một cột cho mỗi giờ, ô 0 in dấu chấm, dòng cộng đúng', () => {
    const heat = spec.sections[0]!;
    expect(heat.columns.map((c) => c.header)).toEqual(['Thứ', '7h', '8h', '9h', 'Cộng']);
    expect(heat.rows[0]).toEqual(['Thứ Hai', '·', '2', '5', '7']);
    expect(heat.totalRows?.[0]).toEqual(['Cộng', '1', '2', '5', '8']);
  });

  it('dòng tóm tắt có giờ cao điểm, ngày ít khách nhất, chờ trung bình', () => {
    expect(spec.infoLines?.join(' ')).toContain('Thứ Hai 9h (5 lượt)');
    expect(spec.infoLines?.join(' ')).toContain('Thứ Ba (1 lượt)');
    expect(spec.infoLines?.join(' ')).toContain('28 phút');
    expect(spec.infoLines?.join(' ')).toContain('50% (2 trên 4 lượt)');
    expect(spec.sections.map((s) => s.title)).toEqual(['Lượt khám theo thứ và giờ tiếp nhận', 'Chờ theo khung giờ', 'Phân bố thời gian chờ']);
  });

  it('nhiều chi nhánh thì có dòng Phạm vi', () => {
    expect(buildPeakHoursPrintSpec(report, { ...ctx, scopeLabel: 'Quận 1, Quận 7' }).subtitleLines).toContain('Phạm vi: Quận 1, Quận 7');
    expect(spec.subtitleLines).toEqual(['Từ 01/10/2026 đến 31/10/2026']);
  });
});

describe('bản in các báo cáo theo kỳ khác', () => {
  it('thời gian chờ: theo bác sĩ và theo ngày; chưa đo được thì "—"', () => {
    const report: WaitingReport = {
      ...base,
      summary: waiting,
      maxMinutes: 50,
      byDoctor: [{ doctorId: null, doctorName: 'Chưa gán bác sĩ', visits: 2, averageMinutes: null, over30Count: 0, over30Percent: null }],
      byDay: [{ date: '2026-10-07', visits: 2, averageMinutes: 28, over30Count: 1, over30Percent: 50 }],
    };
    const spec = buildWaitingPrintSpec(report, ctx);
    expect(spec.sections[0]!.rows[0]).toEqual(['Chưa gán bác sĩ', '2', '—', '0', '—']);
    expect(spec.sections[1]!.rows[0]).toEqual(['07/10/2026', '2', '28', '1', '50%']);
    expect(spec.infoLines?.[0]).toContain('Chờ lâu nhất: 50 phút');
  });

  it('huỷ và không đến: lý do rỗng in "Không ghi lý do"', () => {
    const report: CancellationReport = {
      ...base,
      encounters: { total: 10, cancelled: 1, noShow: 2 },
      appointments: { total: 5, cancelled: 1, noShow: 0, rescheduled: 1 },
      reasons: [{ reason: '', encounterCount: 1, appointmentCount: 0 }],
      byDoctor: [],
      byDay: [],
    };
    const spec = buildCancellationPrintSpec(report, ctx);
    expect(spec.sections[0]!.rows).toEqual([['Không ghi lý do', '1', '0']]);
    expect(spec.sections[1]!.emptyText).toBeTruthy();
    expect(spec.infoLines?.[0]).toContain('dời 1');
  });

  it('tái khám: nhãn kết quả nhắc bằng tiếng Việt, mã lạ giữ nguyên', () => {
    const report: FollowUpReport = {
      ...base,
      summary: { total: 3, arrived: 1, overdue: 1, pending: 1, notReturning: 2, arrivalPercent: 50 },
      byDoctor: [],
      reminders: [{ result: 'NO_ANSWER', count: 2 }, { result: 'LA', count: 1 }],
    };
    const spec = buildFollowUpPrintSpec(report, ctx);
    expect(spec.sections[1]!.rows[0]![0]).not.toBe('NO_ANSWER');
    expect(spec.sections[1]!.rows[1]).toEqual(['LA', '1']);
    expect(spec.infoLines?.[0]).toContain('Tỉ lệ đến: 50%');
  });

  it('nguồn đặt lịch: nhãn nguồn tiếng Việt và nguồn nhiều nhất', () => {
    const report: BookingSourceReport = {
      ...base,
      total: 4,
      arrived: 1,
      arrivalPercent: 25,
      topSource: 'phone',
      sources: [{ source: 'phone', total: 4, arrived: 1, pending: 1, cancelled: 1, noShow: 1, rescheduled: 0, arrivalPercent: 25 }],
    };
    const spec = buildBookingSourcePrintSpec(report, ctx);
    expect(spec.sections[0]!.rows[0]![0]).toBe('Điện thoại');
    expect(spec.infoLines?.[0]).toContain('Nguồn nhiều nhất: Điện thoại');
  });
});

describe('bản in Sổ khám bệnh', () => {
  const row = (over: Partial<VisitBookRow> = {}): VisitBookRow => ({
    encounterId: '00000000-0000-4000-8000-000000000001',
    encounterNo: 'LK2611000001',
    patientId: '00000000-0000-4000-8000-000000000002',
    patientCode: 'BN2611000001',
    patientName: 'Nguyễn Thị Mai',
    ageYears: 34,
    gender: 'female',
    visitDate: '2026-11-04',
    branchId: '00000000-0000-4000-8000-000000000003',
    branchName: 'Quận 1',
    diagnosisCode: 'J06.9',
    diagnosisName: 'Nhiễm trùng hô hấp trên cấp',
    doctorId: null,
    doctorName: 'BS. An',
    services: ['Khám nội', 'Xét nghiệm máu'],
    amount: 385000,
    ...over,
  });
  const options = { ...ctx, multiBranch: false, filterLines: ['Chẩn đoán chính: J06'] };

  it('dòng đủ cột, dịch vụ nối bằng dấu chấm phẩy, có dòng cộng tiền', () => {
    const spec = buildVisitBookPrintSpec([row(), row({ ageYears: null, diagnosisCode: null, doctorName: null, services: [], amount: 0 })], 2, options);
    const rows = spec.sections[0]!.rows;
    expect(rows[0]).toEqual(['1', '04/11', 'LK2611000001', 'BN2611000001', 'Nguyễn Thị Mai', '34', 'Nữ', 'J06.9 Nhiễm trùng hô hấp trên cấp', 'BS. An', 'Khám nội; Xét nghiệm máu', (385000).toLocaleString('vi-VN')]);
    expect(rows[1]).toEqual(['2', '04/11', 'LK2611000001', 'BN2611000001', 'Nguyễn Thị Mai', '', 'Nữ', '', '', '', '0']);
    expect(spec.sections[0]!.totalRows?.[0]?.[spec.sections[0]!.columns.length - 1]).toBe((385000).toLocaleString('vi-VN'));
    expect(spec.subtitleLines).toContain('Chẩn đoán chính: J06');
    expect(spec.note).toBeUndefined();
  });

  it('nhiều chi nhánh thêm cột Chi nhánh và đủ số ô mỗi dòng', () => {
    const spec = buildVisitBookPrintSpec([row()], 1, { ...options, multiBranch: true });
    const section = spec.sections[0]!;
    expect(section.columns.map((c) => c.header)).toContain('Chi nhánh');
    expect(section.rows[0]).toHaveLength(section.columns.length);
    expect(section.totalRows?.[0]).toHaveLength(section.columns.length);
  });

  it('khi tổng dòng khớp lớn hơn số dòng in thì ghi chú chỉ in phần đầu', () => {
    const spec = buildVisitBookPrintSpec([row()], 6200, options);
    expect(spec.note).toContain('6.200');
  });

  it('không có dòng thì có chữ thay thế và không có dòng cộng', () => {
    const spec = buildVisitBookPrintSpec([], 0, options);
    expect(spec.sections[0]!.emptyText).toBeTruthy();
    expect(spec.sections[0]!.totalRows).toBeUndefined();
  });
});
