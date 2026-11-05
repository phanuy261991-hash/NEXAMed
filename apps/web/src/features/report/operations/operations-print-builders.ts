import type { BookingSourceReport, CancellationReport, FollowUpReminderResultKind, FollowUpReport, PeakHoursReport, VisitBookRow, WaitingReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import { formatVndPlain } from '../../../shared/format/currency';
import { REPORT_PRINT_ROW_CAP, type ReportPrintSpec } from '../../../shared/print/report-print-spec';
import { APPOINTMENT_SOURCE_LABEL } from '../../appointment/appointment-status';
import { FOLLOW_UP_REMINDER_RESULT_LABEL } from '../../follow-up/follow-up-model';
import { GENDER_LABEL } from '../../patient/patient-form.utils';
import { formatMinutes, formatPeak, formatPercent, WEEKDAY_LABEL } from './operations-model';

/**
 * Hàm THUẦN đổi báo cáo của nhóm "Khám bệnh và vận hành" (đã tải trên màn hình) thành bản in A4 (docs/DECISIONS.md #287: mọi báo cáo phải in được trực tiếp). Không gọi API; `ReportTablePrintView`
 * vẽ ra giấy qua loại chứng từ `REPORT`. Số tiền không hậu tố "đ" (đơn vị đã rõ từ ngữ cảnh), cùng cách của các báo cáo đã có.
 */
interface PrintContext {
  from: string;
  to: string;
  /** "Quận 1, Quận 7" khi báo cáo gộp từ hai chi nhánh; `null` ở công ty/phạm vi một chi nhánh. */
  scopeLabel: string | null;
}

const n = (value: number): string => value.toLocaleString('vi-VN');
const dash = (value: number | null, render: (v: number) => string = String): string => (value === null ? '—' : render(value));
const period = (from: string, to: string): string => `Từ ${formatDobDisplay(from)} đến ${formatDobDisplay(to)}`;

function subtitle(ctx: PrintContext): string[] {
  return [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : [])];
}

export function buildPeakHoursPrintSpec(report: PeakHoursReport, ctx: PrintContext): ReportPrintSpec {
  const w = report.waiting;
  return {
    title: 'Giờ cao điểm',
    subtitleLines: subtitle(ctx),
    infoLines: [
      `Giờ cao điểm: ${formatPeak(report.peak)}${report.peak ? ` (${report.peak.count} lượt)` : ''} · Ngày ít khách nhất: ${report.quietestDay ? `${WEEKDAY_LABEL[report.quietestDay.isoDow]} (${report.quietestDay.total} lượt)` : '—'}`,
      `Chờ trung bình: ${formatMinutes(w.averageMinutes)} · Chờ quá 30 phút: ${formatPercent(w.over30Percent)} (${w.over30Count} trên ${w.measuredCount} lượt)`,
    ],
    sections: [
      {
        title: 'Lượt khám theo thứ và giờ tiếp nhận',
        columns: [{ header: 'Thứ' }, ...report.hours.map((h) => ({ header: `${h}h`, align: 'right' as const })), { header: 'Cộng', align: 'right' as const }],
        rows: report.days.map((d) => [WEEKDAY_LABEL[d.isoDow] ?? '', ...d.counts.map((c) => (c > 0 ? String(c) : '·')), String(d.total)]),
        totalRows: [['Cộng', ...report.hours.map((_, i) => String(report.days.reduce((s, d) => s + (d.counts[i] ?? 0), 0))), String(report.totalVisits)]],
        emptyText: 'Không có lượt khám nào trong kỳ.',
      },
      {
        title: 'Chờ theo khung giờ',
        columns: [{ header: 'Khung giờ' }, { header: 'Lượt', align: 'right' }, { header: 'Chờ TB (phút)', align: 'right' }, { header: 'Chờ > 30 phút', align: 'right' }],
        rows: w.slots.map((s) => [s.label, String(s.visits), dash(s.averageMinutes), formatPercent(s.over30Percent)]),
        emptyText: 'Chưa đo được thời gian chờ của lượt nào.',
      },
      {
        title: 'Phân bố thời gian chờ',
        columns: [{ header: 'Thời gian chờ' }, { header: 'Số lượt', align: 'right' }, { header: 'Tỉ lệ', align: 'right' }],
        rows: w.distribution.map((d) => [d.label, String(d.count), formatPercent(d.percent)]),
      },
    ],
  };
}

export function buildWaitingPrintSpec(report: WaitingReport, ctx: PrintContext): ReportPrintSpec {
  const s = report.summary;
  return {
    title: 'Thời gian chờ',
    subtitleLines: subtitle(ctx),
    infoLines: [`Lượt đo được: ${n(s.measuredCount)} · Chờ trung bình: ${formatMinutes(s.averageMinutes)} · Chờ lâu nhất: ${formatMinutes(report.maxMinutes)} · Chờ quá 30 phút: ${formatPercent(s.over30Percent)} (${n(s.over30Count)} lượt)`],
    sections: [
      {
        title: 'Theo bác sĩ',
        columns: [{ header: 'Bác sĩ' }, { header: 'Lượt', align: 'right' }, { header: 'Chờ TB (phút)', align: 'right' }, { header: 'Chờ > 30 phút', align: 'right' }, { header: 'Tỉ lệ', align: 'right' }],
        rows: report.byDoctor.map((d) => [d.doctorName, String(d.visits), dash(d.averageMinutes), String(d.over30Count), formatPercent(d.over30Percent)]),
        emptyText: 'Chưa đo được thời gian chờ của lượt nào.',
      },
      {
        title: 'Theo ngày',
        columns: [{ header: 'Ngày' }, { header: 'Lượt', align: 'right' }, { header: 'Chờ TB (phút)', align: 'right' }, { header: 'Chờ > 30 phút', align: 'right' }, { header: 'Tỉ lệ', align: 'right' }],
        rows: report.byDay.map((d) => [formatDobDisplay(d.date), String(d.visits), dash(d.averageMinutes), String(d.over30Count), formatPercent(d.over30Percent)]),
        emptyText: 'Chưa đo được thời gian chờ của lượt nào.',
      },
    ],
  };
}

export function buildCancellationPrintSpec(report: CancellationReport, ctx: PrintContext): ReportPrintSpec {
  const e = report.encounters;
  const a = report.appointments;
  const counts = [{ header: 'Khám huỷ', align: 'right' as const }, { header: 'Khám không đến', align: 'right' as const }, { header: 'Hẹn huỷ', align: 'right' as const }, { header: 'Hẹn không đến', align: 'right' as const }];
  return {
    title: 'Huỷ và không đến',
    subtitleLines: subtitle(ctx),
    infoLines: [`Lượt khám: ${n(e.total)} (huỷ ${n(e.cancelled)}, không đến ${n(e.noShow)}) · Lịch hẹn: ${n(a.total)} (huỷ ${n(a.cancelled)}, không đến ${n(a.noShow)}, dời ${n(a.rescheduled)})`],
    sections: [
      {
        title: 'Lý do huỷ',
        columns: [{ header: 'Lý do' }, { header: 'Lượt khám huỷ', align: 'right' }, { header: 'Lịch hẹn huỷ', align: 'right' }],
        rows: report.reasons.map((r) => [r.reason === '' ? 'Không ghi lý do' : r.reason, String(r.encounterCount), String(r.appointmentCount)]),
        emptyText: 'Không có lượt khám hoặc lịch hẹn nào bị huỷ.',
      },
      {
        title: 'Theo bác sĩ',
        columns: [{ header: 'Bác sĩ' }, ...counts],
        rows: report.byDoctor.map((d) => [d.doctorName, String(d.encounterCancelled), String(d.encounterNoShow), String(d.appointmentCancelled), String(d.appointmentNoShow)]),
        emptyText: 'Không có trường hợp nào.',
      },
      {
        title: 'Theo ngày',
        columns: [{ header: 'Ngày' }, ...counts],
        rows: report.byDay.map((d) => [formatDobDisplay(d.date), String(d.encounterCancelled), String(d.encounterNoShow), String(d.appointmentCancelled), String(d.appointmentNoShow)]),
        emptyText: 'Không có trường hợp nào.',
      },
    ],
  };
}

export function buildFollowUpPrintSpec(report: FollowUpReport, ctx: PrintContext): ReportPrintSpec {
  const s = report.summary;
  return {
    title: 'Tái khám',
    subtitleLines: subtitle(ctx),
    infoLines: [`Hẹn trong kỳ: ${n(s.total)} · Đã đến: ${n(s.arrived)} · Quá hạn chưa đến: ${n(s.overdue)} · Còn chờ: ${n(s.pending)} · Bệnh nhân không tái khám: ${n(s.notReturning)} · Tỉ lệ đến: ${formatPercent(s.arrivalPercent)}`],
    sections: [
      {
        title: 'Theo bác sĩ',
        columns: [{ header: 'Bác sĩ' }, { header: 'Hẹn', align: 'right' }, { header: 'Đã đến', align: 'right' }, { header: 'Quá hạn chưa đến', align: 'right' }, { header: 'Còn chờ', align: 'right' }, { header: 'Tỉ lệ đến', align: 'right' }],
        rows: report.byDoctor.map((d) => [d.doctorName, String(d.total), String(d.arrived), String(d.overdue), String(d.pending), formatPercent(d.arrivalPercent)]),
        emptyText: 'Không có hẹn tái khám nào trong kỳ.',
      },
      {
        title: 'Các lần nhắc trong kỳ',
        columns: [{ header: 'Kết quả nhắc' }, { header: 'Số lần', align: 'right' }],
        rows: report.reminders.map((r) => [FOLLOW_UP_REMINDER_RESULT_LABEL[r.result as FollowUpReminderResultKind] ?? r.result, String(r.count)]),
        emptyText: 'Không có lần nhắc nào trong kỳ.',
      },
    ],
  };
}

export function buildBookingSourcePrintSpec(report: BookingSourceReport, ctx: PrintContext): ReportPrintSpec {
  const label = (source: string) => (APPOINTMENT_SOURCE_LABEL as Record<string, string>)[source] ?? source;
  return {
    title: 'Nguồn đặt lịch',
    subtitleLines: subtitle(ctx),
    infoLines: [`Lịch hẹn: ${n(report.total)} · Đã đến: ${n(report.arrived)} · Tỉ lệ đến: ${formatPercent(report.arrivalPercent)}${report.topSource ? ` · Nguồn nhiều nhất: ${label(report.topSource)}` : ''}`],
    sections: [
      {
        columns: [{ header: 'Nguồn đặt lịch' }, { header: 'Lịch hẹn', align: 'right' }, { header: 'Đã đến', align: 'right' }, { header: 'Còn chờ', align: 'right' }, { header: 'Huỷ', align: 'right' }, { header: 'Không đến', align: 'right' }, { header: 'Dời lịch', align: 'right' }, { header: 'Tỉ lệ đến', align: 'right' }],
        rows: report.sources.map((s) => [label(s.source), String(s.total), String(s.arrived), String(s.pending), String(s.cancelled), String(s.noShow), String(s.rescheduled), formatPercent(s.arrivalPercent)]),
        emptyText: 'Không có lịch hẹn nào trong kỳ.',
      },
    ],
  };
}

/** Sổ khám bệnh: `rows` là các dòng đã tải đủ (tối đa `REPORT_PRINT_ROW_CAP`), `total` là tổng số dòng khớp bộ lọc — nhỏ hơn thì ghi chú "chỉ in phần đầu". */
export function buildVisitBookPrintSpec(rows: readonly VisitBookRow[], total: number, ctx: PrintContext & { multiBranch: boolean; filterLines: string[] }): ReportPrintSpec {
  const multi = ctx.multiBranch;
  const sumAmount = rows.reduce((s, r) => s + r.amount, 0);
  return {
    title: 'Sổ khám bệnh',
    subtitleLines: [...subtitle(ctx), ...ctx.filterLines],
    infoLines: [`Số lượt khám: ${n(total)}`],
    sections: [
      {
        columns: [
          { header: 'STT', align: 'right', width: '34px' },
          { header: 'Ngày khám', width: '62px' },
          { header: 'Số lượt khám', width: '100px' },
          { header: 'Mã BN', width: '90px' },
          { header: 'Họ tên' },
          { header: 'Tuổi', align: 'right', width: '34px' },
          { header: 'Giới', width: '38px' },
          ...(multi ? [{ header: 'Chi nhánh' }] : []),
          { header: 'Chẩn đoán chính' },
          { header: 'Bác sĩ' },
          { header: 'Dịch vụ' },
          { header: 'Thành tiền', align: 'right' as const, width: '78px' },
        ],
        rows: rows.map((r, i) => [
          String(i + 1),
          formatDobDisplay(r.visitDate).slice(0, 5),
          r.encounterNo,
          r.patientCode,
          r.patientName,
          r.ageYears === null ? '' : String(r.ageYears),
          GENDER_LABEL[r.gender] ?? r.gender,
          ...(multi ? [r.branchName] : []),
          r.diagnosisCode ? `${r.diagnosisCode} ${r.diagnosisName ?? ''}`.trim() : '',
          r.doctorName ?? '',
          r.services.join('; '),
          formatVndPlain(r.amount),
        ]),
        totalRows: rows.length > 0 ? [['', '', '', '', `Cộng ${n(rows.length)} dòng`, '', '', ...(multi ? [''] : []), '', '', '', formatVndPlain(sumAmount)]] : undefined,
        emptyText: 'Không có lượt khám nào trong khoảng ngày đã chọn.',
      },
    ],
    note: total > rows.length ? `Chỉ in ${n(REPORT_PRINT_ROW_CAP)} dòng mới nhất trong ${n(total)} lượt khám khớp bộ lọc; thu hẹp bộ lọc để in phần còn lại.` : undefined,
  };
}
