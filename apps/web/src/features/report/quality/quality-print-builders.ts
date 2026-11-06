import type { QualityIncompleteReport, QualityInteropReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import type { ReportPrintSpec } from '../../../shared/print/report-print-spec';
import { formatPercent } from '../operations/operations-model';
import { encounterStatusLabel, formatAttempts, formatDaysOpen, interopStatusLabel, joinErrors } from './quality-model';

/**
 * Hàm THUẦN đổi báo cáo Chất lượng và tuân thủ (đã tải trên màn hình) thành bản in A4 (docs/DECISIONS.md #287: mọi báo cáo phải in được trực tiếp). Không gọi API; `ReportTablePrintView` vẽ ra giấy
 * qua loại chứng từ `REPORT`. Cùng số liệu với màn hình và Excel.
 */
export interface QualityPrintContext {
  from: string;
  to: string;
  /** "Tất cả chi nhánh (3)" khi báo cáo gộp từ hai chi nhánh; `null` ở phạm vi một chi nhánh. */
  scopeLabel: string | null;
}

const n = (value: number | null): string => (value === null ? '—' : value.toLocaleString('vi-VN'));
const scopeLine = (ctx: QualityPrintContext): string[] => (ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : []);

/** "10/09/2026 09:05" từ mốc thời gian ISO, theo giờ Việt Nam. */
function formatDateTimeVn(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function buildQualityIncompletePrintSpec(report: QualityIncompleteReport, ctx: QualityPrintContext): ReportPrintSpec {
  const s = report.summary;
  const multi = report.branchCount > 1;
  return {
    title: 'Lượt khám chưa hoàn tất',
    subtitleLines: [`Tình trạng đến hết ngày ${formatDobDisplay(report.asOf)}`, ...scopeLine(ctx)],
    infoLines: [
      `Lượt khám treo: ${n(s.staleEncounters)} · Ca thu ngân chưa đóng: ${n(s.openShifts)} · Phiếu chưa thu từ ngày trước: ${n(s.unpaidInvoices)} · Treo lâu nhất: ${s.oldestEncounterDays === null ? '—' : formatDaysOpen(s.oldestEncounterDays)}`,
      'Lượt chờ khám hoặc đang khám từ các ngày trước, ca thu ngân mở từ các ngày trước mà chưa đóng.',
    ],
    sections: [
      {
        title: 'Lượt khám treo',
        columns: [
          { header: 'Mã lượt khám' },
          { header: 'Bệnh nhân' },
          ...(multi ? [{ header: 'Chi nhánh' }] : []),
          { header: 'Bác sĩ' },
          { header: 'Tiếp nhận', align: 'right' as const },
          { header: 'Trạng thái' },
          { header: 'Đã treo', align: 'right' as const },
        ],
        rows: report.encounters.map((r) => [r.encounterNo, `${r.patientName} (${r.patientCode})`, ...(multi ? [r.branchName] : []), r.doctorName ?? '—', formatDobDisplay(r.visitDate), encounterStatusLabel(r.status), formatDaysOpen(r.daysOpen)]),
        emptyText: 'Không có lượt khám nào treo từ các ngày trước.',
      },
      {
        title: 'Ca thu ngân chưa đóng',
        columns: [{ header: 'Mã ca' }, { header: 'Thu ngân' }, ...(multi ? [{ header: 'Chi nhánh' }] : []), { header: 'Mở lúc', align: 'right' as const }, { header: 'Đã mở', align: 'right' as const }],
        rows: report.shifts.map((r) => [r.shiftNo, r.cashierName, ...(multi ? [r.branchName] : []), formatDateTimeVn(r.openedAt), formatDaysOpen(r.daysOpen)]),
        emptyText: 'Không có ca thu ngân nào mở từ các ngày trước.',
      },
    ],
    ...(s.staleEncounters > report.encounters.length ? { note: `Chỉ in ${report.encounters.length} trong ${s.staleEncounters} lượt khám treo (treo lâu nhất trước).` } : {}),
  };
}

export function buildQualityInteropPrintSpec(report: QualityInteropReport, ctx: QualityPrintContext): ReportPrintSpec {
  const s = report.summary;
  const multi = report.branchCount > 1;
  return {
    title: 'Liên thông đơn thuốc',
    subtitleLines: [`Từ ${formatDobDisplay(ctx.from)} đến ${formatDobDisplay(ctx.to)}`, ...scopeLine(ctx)],
    infoLines: [
      `Đơn: ${n(s.total)} · Đã gửi: ${n(s.sent)} (${formatPercent(s.sentPercent)}) · Chờ gửi: ${n(s.pending)} · Cổng từ chối: ${n(s.failed)} · Tồn cũ nhất: ${s.oldestUnsentDays === null ? '—' : `${s.oldestUnsentDays} ngày`}`,
      'Đơn thuốc đã ký trong kỳ (theo ngày ký) và tình trạng gửi lên cổng đơn thuốc quốc gia; tồn = chờ gửi hoặc cổng từ chối.',
    ],
    sections: [
      {
        title: 'Theo bác sĩ',
        columns: [{ header: 'Bác sĩ' }, { header: 'Đơn', align: 'right' }, { header: 'Đã gửi', align: 'right' }, { header: 'Chờ gửi', align: 'right' }, { header: 'Cổng từ chối', align: 'right' }],
        rows: report.byDoctor.map((d) => [d.doctorName, n(d.total), n(d.sent), n(d.pending), n(d.failed)]),
        totalRows: [['Cộng', n(s.total), n(s.sent), n(s.pending), n(s.failed)]],
        emptyText: 'Không có đơn thuốc nào ký trong kỳ đã chọn.',
      },
      {
        title: 'Đơn chờ gửi hoặc bị cổng từ chối',
        columns: [
          { header: 'Mã lượt khám' },
          { header: 'Bệnh nhân' },
          ...(multi ? [{ header: 'Chi nhánh' }] : []),
          { header: 'Bác sĩ' },
          { header: 'Ký lúc', align: 'right' as const },
          { header: 'Trạng thái' },
          { header: 'Thử', align: 'right' as const },
          { header: 'Lỗi' },
        ],
        rows: report.problems.map((r) => [r.encounterNo, `${r.patientName} (${r.patientCode})`, ...(multi ? [r.branchName] : []), r.doctorName ?? '—', formatDateTimeVn(r.signedAt), interopStatusLabel(r.status), formatAttempts(r.attempts), joinErrors(r.errors)]),
        emptyText: 'Không có đơn nào chờ gửi hoặc bị cổng từ chối.',
      },
    ],
    ...(report.problemTotal > report.problems.length ? { note: `Chỉ in ${report.problems.length} trong ${report.problemTotal} đơn tồn (cũ nhất trước).` } : {}),
  };
}
