import type { PatientDemographicsReport, PatientNewReturningReport, PatientNotReturningReport } from '@nexamed/shared';
import type { ReportExcelHeader } from '../../common/report-excel-header';
import type { ReportExportContext } from '../../common/report-export-support';
import { buildTableReportExcel } from '../../common/report-table-excel';

/**
 * Bản Excel của trang báo cáo "Bệnh nhân" (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel). Mỗi hàm đổi báo cáo đã tính (cùng số với màn hình) thành bảng Excel có đầu chuẩn; ô số
 * ghi SỐ để cộng/lọc được trong Excel. Không biết gì về truy vấn hay phạm vi — nhận ngữ cảnh đã dựng sẵn.
 */
const pct = (value: number | null): string => (value === null ? '—' : `${String(value).replace('.', ',')}%`);
const share = (part: number, whole: number): string => (whole <= 0 ? '—' : pct(Math.round((part / whole) * 1000) / 10));
const monthLabel = (m: string): string => `${m.slice(5)}/${m.slice(0, 4)}`;
const sumBands = (report: PatientDemographicsReport, key: 'male' | 'female' | 'other'): number => report.ageBands.reduce((s, b) => s + b[key], 0);

function header(ctx: ReportExportContext, title: string, from: string, to: string): ReportExcelHeader {
  return { clinicName: ctx.clinicName, branchName: ctx.branchName, title, from, to, scopeLabel: ctx.scopeLabel, exportedByName: ctx.exportedByName, exportedAt: ctx.exportedAt };
}

const REMINDER_LABEL: Record<string, string> = { REACHED: 'Đã liên lạc được', NO_ANSWER: 'Không nghe máy', CALL_BACK_LATER: 'Hẹn gọi lại', NOT_RETURNING: 'Bệnh nhân không tái khám' };

export function buildPatientNewReturningExcel(report: PatientNewReturningReport, ctx: ReportExportContext): Promise<Buffer> {
  const s = report.summary;
  return buildTableReportExcel([
    {
      name: 'Bệnh nhân mới và cũ',
      header: header(ctx, 'Bệnh nhân mới và cũ', report.from, report.to),
      infoLines: [
        'Lượt khám: lượt đã tiếp nhận. Bệnh nhân mới: lượt khám đầu tiên của bệnh nhân (ở bất kỳ chi nhánh nào của công ty) rơi vào kỳ; bệnh nhân cũ: đã khám trước kỳ.',
        `Bệnh nhân có khám: ${s.patients} · Mới: ${s.newPatients} · Cũ: ${s.returningPatients} (${pct(s.returningPercent)}) · Lượt khám: ${s.visits}`,
      ],
      sections: [
        {
          title: 'Theo tháng',
          columns: [
            { header: 'Tháng', width: 12 },
            { header: 'Bệnh nhân có khám', width: 18, numeric: true },
            { header: 'Bệnh nhân mới', width: 16, numeric: true },
            { header: 'Bệnh nhân cũ', width: 16, numeric: true },
            { header: 'Lượt khám', width: 12, numeric: true },
          ],
          rows: report.byMonth.map((m) => [monthLabel(m.month), m.patients, m.newPatients, m.returningPatients, m.visits]),
          emptyText: 'Không có lượt khám nào trong kỳ.',
        },
        {
          title: 'Số lượt khám của mỗi bệnh nhân trong kỳ',
          columns: [{ header: 'Số lượt', width: 18 }, { header: 'Số bệnh nhân', width: 16, numeric: true }, { header: 'Tỉ lệ', width: 10 }],
          rows: report.frequency.map((f) => [f.label, f.patients, share(f.patients, s.patients)]),
        },
        {
          title: 'Bệnh nhân cũ: thời gian từ lượt khám liền trước',
          columns: [{ header: 'Khoảng', width: 18 }, { header: 'Số bệnh nhân', width: 16, numeric: true }, { header: 'Tỉ lệ', width: 10 }],
          rows: report.gap.map((g) => [g.label, g.patients, share(g.patients, s.returningPatients)]),
        },
      ],
    },
  ]);
}

export function buildPatientDemographicsExcel(report: PatientDemographicsReport, ctx: ReportExportContext): Promise<Buffer> {
  const g = report.genders;
  return buildTableReportExcel([
    {
      name: 'Tuổi, giới và địa bàn',
      header: header(ctx, 'Tuổi, giới và địa bàn', report.from, report.to),
      infoLines: [
        'Bệnh nhân có ít nhất một lượt khám trong kỳ. Tuổi tính đến ngày cuối kỳ; địa bàn theo tỉnh/thành và phường/xã ghi trên hồ sơ.',
        `Bệnh nhân: ${report.patients} · Nam: ${g.male} · Nữ: ${g.female} · Khác: ${g.other}`,
      ],
      sections: [
        {
          title: 'Theo khoảng tuổi và giới',
          columns: [
            { header: 'Khoảng tuổi', width: 18 },
            { header: 'Nam', width: 10, numeric: true },
            { header: 'Nữ', width: 10, numeric: true },
            { header: 'Khác', width: 10, numeric: true },
            { header: 'Cộng', width: 10, numeric: true },
            { header: 'Tỉ lệ', width: 10 },
          ],
          rows: report.ageBands.map((b) => [b.label, b.male, b.female, b.other, b.total, share(b.total, report.patients)]),
          totalRows: [
            ['Cộng', sumBands(report, 'male'), sumBands(report, 'female'), sumBands(report, 'other'), report.patients - report.unknownAge, ''],
            ...(report.unknownAge > 0 ? [['Chưa có ngày sinh hợp lệ', null, null, null, report.unknownAge, '']] : []),
          ],
        },
        {
          title: 'Theo tỉnh/thành',
          columns: [{ header: 'Tỉnh/thành', width: 30 }, { header: 'Số bệnh nhân', width: 16, numeric: true }, { header: 'Tỉ lệ', width: 10 }],
          rows: report.provinces.map((p) => [p.name, p.patients, share(p.patients, report.patients)]),
          totalRows: report.unknownProvince > 0 ? [['Chưa ghi tỉnh/thành', report.unknownProvince, share(report.unknownProvince, report.patients)]] : undefined,
          emptyText: 'Chưa có hồ sơ nào ghi tỉnh/thành.',
        },
        {
          title: 'Phường/xã có nhiều bệnh nhân nhất',
          columns: [{ header: 'Phường/xã', width: 30 }, { header: 'Tỉnh/thành', width: 24 }, { header: 'Số bệnh nhân', width: 16, numeric: true }],
          rows: report.wards.map((w) => [w.name, w.provinceName, w.patients]),
          emptyText: 'Chưa có hồ sơ nào ghi phường/xã.',
        },
      ],
    },
  ]);
}

export function buildPatientNotReturningExcel(report: PatientNotReturningReport, ctx: ReportExportContext): Promise<Buffer> {
  const s = report.summary;
  const multiBranch = report.branchCount > 1;
  const columns = [
    { header: 'Mã bệnh nhân', width: 16 },
    { header: 'Bệnh nhân', width: 28 },
    { header: 'Điện thoại', width: 16 },
    ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
    { header: 'Bác sĩ', width: 24 },
    { header: 'Ngày khám', width: 13 },
    { header: 'Ngày hẹn', width: 13 },
    { header: 'Quá hạn (ngày)', width: 15, numeric: true },
    { header: 'Số lần nhắc', width: 12, numeric: true },
    { header: 'Kết quả nhắc gần nhất', width: 26 },
  ];
  const day = (d: string): string => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  return buildTableReportExcel([
    {
      name: 'Bệnh nhân không quay lại',
      header: header(ctx, 'Bệnh nhân không quay lại', report.from, report.to),
      infoLines: [
        'Bệnh nhân có hẹn tái khám (kế hoạch đã ký) với ngày hẹn trong kỳ và đã qua, nhưng chưa có lượt khám nào sau lượt đã hẹn. Mỗi bệnh nhân một dòng, quá hạn lâu nhất trước.',
        `Bệnh nhân: ${s.patients} · Đã được nhắc: ${s.reminded} · Đã ghi không tái khám: ${s.markedNotReturning} · Quá hạn trung bình: ${s.avgOverdueDays === null ? '—' : `${s.avgOverdueDays} ngày`}`,
      ],
      sections: [
        {
          columns,
          rows: report.items.map((r) => [
            r.patientCode,
            r.patientName,
            r.phone,
            ...(multiBranch ? [r.branchName] : []),
            r.doctorName ?? '—',
            day(r.visitDate),
            day(r.dueDate),
            r.overdueDays,
            r.reminderCount,
            r.lastReminderResult ? (REMINDER_LABEL[r.lastReminderResult] ?? r.lastReminderResult) : 'Chưa nhắc',
          ]),
          emptyText: 'Không có bệnh nhân nào quá hẹn tái khám mà chưa quay lại trong kỳ đã chọn.',
        },
      ],
      note: report.totalCount > report.items.length ? `Chỉ hiện ${report.items.length} trong ${report.totalCount} bệnh nhân (quá hạn lâu nhất trước).` : undefined,
    },
  ]);
}
