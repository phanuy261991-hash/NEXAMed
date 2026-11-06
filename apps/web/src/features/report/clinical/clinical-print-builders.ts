import type { ClinicalDiagnosisReport, ClinicalParaclinicalReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import type { ReportPrintSpec } from '../../../shared/print/report-print-spec';
import { formatPercent } from '../operations/operations-model';
import { formatDuration, formatWait, kindLabel } from './clinical-model';

/**
 * Hàm THUẦN đổi báo cáo Chuyên môn (đã tải trên màn hình) thành bản in A4 (docs/DECISIONS.md #287: mọi báo cáo phải in được trực tiếp). Không gọi API; `ReportTablePrintView` vẽ ra giấy qua loại
 * chứng từ `REPORT`. Cùng số liệu với màn hình và Excel.
 */
export interface ClinicalPrintContext {
  from: string;
  to: string;
  /** "Tất cả chi nhánh (3)" khi báo cáo gộp từ hai chi nhánh; `null` ở phạm vi một chi nhánh. */
  scopeLabel: string | null;
}

const n = (value: number | null): string => (value === null ? '—' : value.toLocaleString('vi-VN'));
const period = (from: string, to: string): string => `Từ ${formatDobDisplay(from)} đến ${formatDobDisplay(to)}`;
const subtitle = (ctx: ClinicalPrintContext): string[] => [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : [])];

/** "10/09/2026 09:05" từ mốc thời gian ISO, theo giờ Việt Nam. */
function formatDateTimeVn(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function buildClinicalDiagnosisPrintSpec(report: ClinicalDiagnosisReport, ctx: ClinicalPrintContext): ReportPrintSpec {
  const s = report.summary;
  return {
    title: 'Cơ cấu chẩn đoán ICD-10',
    subtitleLines: subtitle(ctx),
    infoLines: [
      `Lượt hoàn tất: ${n(s.completedVisits)} · Có chẩn đoán chính: ${n(s.withDiagnosis)} · Chưa có chẩn đoán: ${n(s.withoutDiagnosis)} · Số mã khác nhau: ${n(s.distinctCodes)}`,
      'Lượt khám đã hoàn tất theo ngày tiếp nhận; mã chẩn đoán chính hiện hành. Tỉ lệ tính trên số lượt có chẩn đoán chính.',
    ],
    sections: [
      {
        title: 'Bệnh hay gặp',
        columns: [{ header: '#', align: 'right' }, { header: 'Mã ICD-10' }, { header: 'Tên bệnh' }, { header: 'Lượt khám', align: 'right' }, { header: 'Bệnh nhân', align: 'right' }, { header: 'Tỉ lệ', align: 'right' }],
        rows: report.rows.map((r, i) => [String(i + 1), r.code, r.name, n(r.visits), n(r.patients), formatPercent(r.percent)]),
        emptyText: 'Chưa có lượt khám nào có chẩn đoán trong kỳ đã chọn.',
      },
      {
        title: 'Theo chương ICD-10',
        columns: [{ header: 'Chương' }, { header: 'Tên chương' }, { header: 'Lượt khám', align: 'right' }, { header: 'Tỉ lệ', align: 'right' }],
        rows: report.chapters.map((c) => [c.chapterCode, c.chapterName, n(c.visits), formatPercent(c.percent)]),
        emptyText: 'Chưa có dữ liệu.',
      },
    ],
  };
}

export function buildClinicalParaclinicalPrintSpec(report: ClinicalParaclinicalReport, ctx: ClinicalPrintContext): ReportPrintSpec {
  const s = report.summary;
  const multiBranch = report.branchCount > 1;
  return {
    title: 'Cận lâm sàng',
    subtitleLines: subtitle(ctx),
    infoLines: [
      `Chỉ định: ${n(s.ordered)} (tại phòng khám ${n(s.inHouse)}, ra ngoài ${n(s.external)}) · Đã trả kết quả: ${n(s.completed)} · Chưa trả: ${n(s.pending)} · Trả kết quả trung bình: ${formatDuration(s.avgMinutes)} · Quá hạn: ${n(s.overdue)}`,
      'Thời gian trả kết quả: từ lúc chỉ định đến lần bác sĩ duyệt đầu tiên. Quá hạn so với thời gian đặt ở dịch vụ (dịch vụ chưa đặt thì không xét).',
    ],
    sections: [
      {
        title: 'Theo nhóm dịch vụ',
        columns: [{ header: 'Nhóm' }, { header: 'Chỉ định', align: 'right' }, { header: 'Tại phòng khám', align: 'right' }, { header: 'Ra ngoài', align: 'right' }, { header: 'Đã trả', align: 'right' }, { header: 'Trả TB', align: 'right' }, { header: 'Quá hạn', align: 'right' }],
        rows: report.byKind.map((k) => [kindLabel(k.kind), n(k.ordered), n(k.inHouse), n(k.external), n(k.completed), formatDuration(k.avgMinutes), n(k.overdue)]),
        totalRows: [['Cộng', n(s.ordered), n(s.inHouse), n(s.external), n(s.completed), formatDuration(s.avgMinutes), n(s.overdue)]],
        emptyText: 'Chưa có chỉ định cận lâm sàng nào trong kỳ đã chọn.',
      },
      {
        title: 'Dịch vụ được chỉ định nhiều nhất',
        columns: [{ header: 'STT', align: 'right' }, { header: 'Dịch vụ' }, { header: 'Nhóm' }, { header: 'Chỉ định', align: 'right' }, { header: 'Đã trả', align: 'right' }, { header: 'Trả TB', align: 'right' }, { header: 'Quá hạn', align: 'right' }],
        rows: report.topServices.map((t, i) => [String(i + 1), t.name, kindLabel(t.kind), n(t.ordered), n(t.completed), formatDuration(t.avgMinutes), n(t.overdue)]),
        emptyText: 'Chưa có chỉ định nào trong kỳ.',
      },
      {
        title: 'Đang chờ và đã quá hạn',
        columns: [
          { header: 'Mã BN' },
          { header: 'Bệnh nhân' },
          { header: 'Dịch vụ' },
          ...(multiBranch ? [{ header: 'Chi nhánh' }] : []),
          { header: 'Chỉ định lúc' },
          { header: 'Hạn trả', align: 'right' as const },
          { header: 'Đã chờ', align: 'right' as const },
        ],
        rows: report.overdueItems.map((o) => [o.patientCode, o.patientName, o.serviceName, ...(multiBranch ? [o.branchName] : []), formatDateTimeVn(o.orderedAt), formatDuration(o.turnaroundMinutes), formatWait(o.waitedMinutes)]),
        emptyText: 'Không có chỉ định nào đang chờ quá hạn.',
      },
    ],
    ...(s.overdueOpen > report.overdueItems.length ? { note: `Chỉ in ${report.overdueItems.length} trong ${s.overdueOpen} chỉ định đang chờ quá hạn (chờ lâu nhất trước).` } : {}),
  };
}
