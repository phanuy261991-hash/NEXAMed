import { ISO_WEEKDAY_LABEL } from '@nexamed/core';
import {
  FOLLOW_UP_REMINDER_RESULT_LABEL,
  type BookingSourceReport,
  type CancellationReport,
  type FollowUpReport,
  type FollowUpReminderResultKind,
  type PeakHoursReport,
  type VisitBookRow,
  type WaitingReport,
} from '@nexamed/shared';
import { formatReportDate, type ReportExcelHeader } from '../../common/report-excel-header';
import { buildTableReportExcel, REPORT_EXPORT_ROW_LIMIT, type ExcelTableSheet } from '../../common/report-table-excel';

/**
 * Bản Excel của nhóm báo cáo "Khám bệnh và vận hành" (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel). Mỗi hàm đổi báo cáo đã tính (cùng số với màn hình) thành bảng Excel
 * có đầu chuẩn; ô số ghi SỐ để cộng/lọc được trong Excel. Không biết gì về truy vấn hay phạm vi — nhận ngữ cảnh đã dựng sẵn.
 */
export interface OperationsExcelContext {
  clinicName: string;
  branchName: string | null;
  scopeLabel: string | null;
  exportedByName: string;
  exportedAt: Date;
}

const GENDER_LABEL: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' };
const SOURCE_LABEL: Record<string, string> = { phone: 'Điện thoại', online: 'Online', walk_in: 'Walk-in' };
const pct = (value: number | null): string => (value === null ? '—' : `${String(value).replace('.', ',')}%`);
const minutes = (value: number | null): string => (value === null ? '—' : `${value} phút`);

function header(ctx: OperationsExcelContext, title: string, from: string, to: string): ReportExcelHeader {
  return { clinicName: ctx.clinicName, branchName: ctx.branchName, title, from, to, scopeLabel: ctx.scopeLabel, exportedByName: ctx.exportedByName, exportedAt: ctx.exportedAt };
}

export function buildVisitBookExcel(rows: readonly VisitBookRow[], total: number, filterLines: string[], range: { from: string; to: string }, multiBranch: boolean, ctx: OperationsExcelContext): Promise<Buffer> {
  const capped = total > rows.length;
  const sheet: ExcelTableSheet = {
    name: 'Sổ khám bệnh',
    header: header(ctx, 'Sổ khám bệnh', range.from, range.to),
    infoLines: [`Tổng số lượt khám khớp bộ lọc: ${total.toLocaleString('vi-VN')}`, ...filterLines],
    sections: [
      {
        columns: [
          { header: 'STT', width: 7, numeric: true },
          { header: 'Ngày khám', width: 13 },
          { header: 'Số lượt khám', width: 16 },
          { header: 'Mã bệnh nhân', width: 16 },
          { header: 'Họ tên', width: 26 },
          { header: 'Tuổi', width: 7, numeric: true },
          { header: 'Giới', width: 8 },
          ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
          { header: 'Mã ICD-10', width: 11 },
          { header: 'Chẩn đoán chính', width: 34 },
          { header: 'Bác sĩ', width: 24 },
          { header: 'Dịch vụ', width: 40 },
          { header: 'Thành tiền', width: 14, numeric: true },
        ],
        rows: rows.map((r, i) => [
          i + 1,
          formatReportDate(r.visitDate),
          r.encounterNo,
          r.patientCode,
          r.patientName,
          r.ageYears,
          GENDER_LABEL[r.gender] ?? r.gender,
          ...(multiBranch ? [r.branchName] : []),
          r.diagnosisCode ?? '',
          r.diagnosisName ?? '',
          r.doctorName ?? '',
          r.services.join('; '),
          r.amount,
        ]),
        emptyText: 'Không có lượt khám nào trong khoảng ngày đã chọn.',
      },
    ],
    note: capped ? `Chỉ xuất ${REPORT_EXPORT_ROW_LIMIT.toLocaleString('vi-VN')} dòng mới nhất; thu hẹp bộ lọc để lấy phần còn lại.` : undefined,
  };
  return buildTableReportExcel([sheet]);
}

export function buildPeakHoursExcel(report: PeakHoursReport, ctx: OperationsExcelContext): Promise<Buffer> {
  const peak = report.peak ? `${ISO_WEEKDAY_LABEL[report.peak.isoDow]} ${report.peak.hour}h (${report.peak.count} lượt)` : '—';
  const quiet = report.quietestDay ? `${ISO_WEEKDAY_LABEL[report.quietestDay.isoDow]} (${report.quietestDay.total} lượt)` : '—';
  const w = report.waiting;
  return buildTableReportExcel([
    {
      name: 'Giờ cao điểm',
      header: header(ctx, 'Giờ cao điểm', report.from, report.to),
      infoLines: [
        `Giờ cao điểm: ${peak} · Ngày ít khách nhất: ${quiet}`,
        `Chờ trung bình: ${minutes(w.averageMinutes)} · Chờ quá 30 phút: ${pct(w.over30Percent)} (${w.over30Count} trên ${w.measuredCount} lượt)`,
      ],
      sections: [
        {
          title: 'Lượt khám theo thứ và giờ tiếp nhận',
          columns: [{ header: 'Thứ', width: 12 }, ...report.hours.map((h) => ({ header: `${h}h`, width: 7, numeric: true })), { header: 'Cộng', width: 9, numeric: true }],
          rows: report.days.map((d) => [ISO_WEEKDAY_LABEL[d.isoDow] ?? '', ...d.counts, d.total]),
          totalRows: [['Cộng', ...report.hours.map((_, i) => report.days.reduce((s, d) => s + (d.counts[i] ?? 0), 0)), report.totalVisits]],
        },
        {
          title: 'Chờ theo khung giờ',
          columns: [{ header: 'Khung giờ', width: 12 }, { header: 'Lượt', width: 10, numeric: true }, { header: 'Chờ TB (phút)', width: 14, numeric: true }, { header: 'Chờ > 30 phút (%)', width: 18, numeric: true }],
          rows: w.slots.map((s) => [s.label, s.visits, s.averageMinutes, s.over30Percent]),
          emptyText: 'Chưa đo được thời gian chờ của lượt nào.',
        },
        {
          title: 'Phân bố thời gian chờ',
          columns: [{ header: 'Thời gian chờ', width: 16 }, { header: 'Số lượt', width: 10, numeric: true }, { header: 'Tỉ lệ (%)', width: 10, numeric: true }],
          rows: w.distribution.map((d) => [d.label, d.count, d.percent]),
        },
      ],
    },
  ]);
}

export function buildWaitingExcel(report: WaitingReport, ctx: OperationsExcelContext): Promise<Buffer> {
  const s = report.summary;
  return buildTableReportExcel([
    {
      name: 'Thời gian chờ',
      header: header(ctx, 'Thời gian chờ', report.from, report.to),
      infoLines: [`Lượt đo được: ${s.measuredCount} · Chờ trung bình: ${minutes(s.averageMinutes)} · Chờ lâu nhất: ${minutes(report.maxMinutes)} · Chờ quá 30 phút: ${pct(s.over30Percent)} (${s.over30Count} lượt)`],
      sections: [
        {
          title: 'Theo bác sĩ',
          columns: [{ header: 'Bác sĩ', width: 28 }, { header: 'Lượt', width: 10, numeric: true }, { header: 'Chờ TB (phút)', width: 14, numeric: true }, { header: 'Chờ > 30 phút (lượt)', width: 20, numeric: true }, { header: 'Chờ > 30 phút (%)', width: 18, numeric: true }],
          rows: report.byDoctor.map((d) => [d.doctorName, d.visits, d.averageMinutes, d.over30Count, d.over30Percent]),
          emptyText: 'Chưa đo được thời gian chờ của lượt nào.',
        },
        {
          title: 'Theo ngày',
          columns: [{ header: 'Ngày', width: 14 }, { header: 'Lượt', width: 10, numeric: true }, { header: 'Chờ TB (phút)', width: 14, numeric: true }, { header: 'Chờ > 30 phút (lượt)', width: 20, numeric: true }, { header: 'Chờ > 30 phút (%)', width: 18, numeric: true }],
          rows: report.byDay.map((d) => [formatReportDate(d.date), d.visits, d.averageMinutes, d.over30Count, d.over30Percent]),
          emptyText: 'Chưa đo được thời gian chờ của lượt nào.',
        },
      ],
    },
  ]);
}

export function buildCancellationExcel(report: CancellationReport, ctx: OperationsExcelContext): Promise<Buffer> {
  const e = report.encounters;
  const a = report.appointments;
  const counts = [
    { header: 'Lượt khám huỷ', width: 16, numeric: true },
    { header: 'Lượt khám không đến', width: 20, numeric: true },
    { header: 'Lịch hẹn huỷ', width: 16, numeric: true },
    { header: 'Lịch hẹn không đến', width: 20, numeric: true },
  ];
  return buildTableReportExcel([
    {
      name: 'Huỷ và không đến',
      header: header(ctx, 'Huỷ và không đến', report.from, report.to),
      infoLines: [`Lượt khám: ${e.total} (huỷ ${e.cancelled}, không đến ${e.noShow}) · Lịch hẹn: ${a.total} (huỷ ${a.cancelled}, không đến ${a.noShow}, dời ${a.rescheduled})`],
      sections: [
        {
          title: 'Lý do huỷ',
          columns: [{ header: 'Lý do', width: 40 }, { header: 'Lượt khám huỷ', width: 16, numeric: true }, { header: 'Lịch hẹn huỷ', width: 16, numeric: true }],
          rows: report.reasons.map((r) => [r.reason === '' ? 'Không ghi lý do' : r.reason, r.encounterCount, r.appointmentCount]),
          emptyText: 'Không có lượt khám hoặc lịch hẹn nào bị huỷ.',
        },
        {
          title: 'Theo bác sĩ',
          columns: [{ header: 'Bác sĩ', width: 28 }, ...counts],
          rows: report.byDoctor.map((d) => [d.doctorName, d.encounterCancelled, d.encounterNoShow, d.appointmentCancelled, d.appointmentNoShow]),
          emptyText: 'Không có trường hợp nào.',
        },
        {
          title: 'Theo ngày',
          columns: [{ header: 'Ngày', width: 14 }, ...counts],
          rows: report.byDay.map((d) => [formatReportDate(d.date), d.encounterCancelled, d.encounterNoShow, d.appointmentCancelled, d.appointmentNoShow]),
          emptyText: 'Không có trường hợp nào.',
        },
      ],
    },
  ]);
}

export function buildFollowUpExcel(report: FollowUpReport, ctx: OperationsExcelContext): Promise<Buffer> {
  const s = report.summary;
  return buildTableReportExcel([
    {
      name: 'Tái khám',
      header: header(ctx, 'Tái khám', report.from, report.to),
      infoLines: [`Hẹn trong kỳ: ${s.total} · Đã đến: ${s.arrived} · Quá hạn chưa đến: ${s.overdue} · Còn chờ: ${s.pending} · Bệnh nhân không tái khám: ${s.notReturning} · Tỉ lệ đến: ${pct(s.arrivalPercent)}`],
      sections: [
        {
          title: 'Theo bác sĩ',
          columns: [{ header: 'Bác sĩ', width: 28 }, { header: 'Hẹn', width: 10, numeric: true }, { header: 'Đã đến', width: 10, numeric: true }, { header: 'Quá hạn chưa đến', width: 18, numeric: true }, { header: 'Còn chờ', width: 10, numeric: true }, { header: 'Tỉ lệ đến (%)', width: 14, numeric: true }],
          rows: report.byDoctor.map((d) => [d.doctorName, d.total, d.arrived, d.overdue, d.pending, d.arrivalPercent]),
          emptyText: 'Không có hẹn tái khám nào trong kỳ.',
        },
        {
          title: 'Các lần nhắc trong kỳ',
          columns: [{ header: 'Kết quả nhắc', width: 28 }, { header: 'Số lần', width: 10, numeric: true }],
          rows: report.reminders.map((r) => [FOLLOW_UP_REMINDER_RESULT_LABEL[r.result as FollowUpReminderResultKind] ?? r.result, r.count]),
          emptyText: 'Không có lần nhắc nào trong kỳ.',
        },
      ],
    },
  ]);
}

export function buildBookingSourceExcel(report: BookingSourceReport, ctx: OperationsExcelContext): Promise<Buffer> {
  return buildTableReportExcel([
    {
      name: 'Nguồn đặt lịch',
      header: header(ctx, 'Nguồn đặt lịch', report.from, report.to),
      infoLines: [`Lịch hẹn: ${report.total} · Đã đến: ${report.arrived} · Tỉ lệ đến: ${pct(report.arrivalPercent)}${report.topSource ? ` · Nguồn nhiều nhất: ${SOURCE_LABEL[report.topSource] ?? report.topSource}` : ''}`],
      sections: [
        {
          columns: [
            { header: 'Nguồn đặt lịch', width: 20 },
            { header: 'Lịch hẹn', width: 12, numeric: true },
            { header: 'Đã đến', width: 10, numeric: true },
            { header: 'Còn chờ', width: 10, numeric: true },
            { header: 'Huỷ', width: 10, numeric: true },
            { header: 'Không đến', width: 12, numeric: true },
            { header: 'Dời lịch', width: 10, numeric: true },
            { header: 'Tỉ lệ đến (%)', width: 14, numeric: true },
          ],
          rows: report.sources.map((s) => [SOURCE_LABEL[s.source] ?? s.source, s.total, s.arrived, s.pending, s.cancelled, s.noShow, s.rescheduled, s.arrivalPercent]),
          emptyText: 'Không có lịch hẹn nào trong kỳ.',
        },
      ],
    },
  ]);
}
