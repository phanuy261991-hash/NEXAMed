import type { SystemCrossReport, SystemMonthlyReport, SystemOverviewReport, SystemRankingReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import type { ReportPrintSpec } from '../../../shared/print/report-print-spec';
import { formatPercent } from '../operations/operations-model';
import { changePercent, formatSignedPercent, monthLabel, monthShort, RANKING_COLUMNS, SYSTEM_GROUP_LABEL, type RankingKind } from './system-model';

/**
 * Hàm THUẦN đổi báo cáo Toàn hệ thống (đã tải trên màn hình) thành bản in A4 (docs/DECISIONS.md #287: mọi báo cáo phải in được trực tiếp). Không gọi API; `ReportTablePrintView` vẽ ra giấy qua loại
 * chứng từ `REPORT`. Số tiền không hậu tố "đ" (đơn vị đã rõ từ ngữ cảnh), cùng cách của các báo cáo đã có.
 */
export interface SystemPrintContext {
  from: string;
  to: string;
  /** "Quận 1, Quận 7" khi báo cáo gộp từ hai chi nhánh; `null` ở phạm vi một chi nhánh. */
  scopeLabel: string | null;
}

const n = (value: number): string => value.toLocaleString('vi-VN');
const dash = (value: number | null): string => (value === null ? '—' : n(value));
const period = (from: string, to: string): string => `Từ ${formatDobDisplay(from)} đến ${formatDobDisplay(to)}`;

function subtitle(ctx: SystemPrintContext, extra: string[] = []): string[] {
  return [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : []), ...extra];
}

export function buildSystemOverviewPrintSpec(report: SystemOverviewReport, ctx: SystemPrintContext): ReportPrintSpec {
  const t = report.totals;
  const k = report.kpis;
  const delta = (kpi: { percent: number | null }) => formatSignedPercent(kpi.percent);
  return {
    title: 'Toàn hệ thống — So sánh chi nhánh',
    subtitleLines: subtitle(ctx, [`So với kỳ trước: ${formatDobDisplay(report.previousFrom)} – ${formatDobDisplay(report.previousTo)}`]),
    infoLines: [
      `Ghi nhận: ${n(k.recognized.value)} (${delta(k.recognized)}) · Thực thu: ${n(k.collected.value)} (${delta(k.collected)}) · Lượt khám: ${n(k.visits.value)} (${delta(k.visits)}) · Bệnh nhân mới: ${n(k.newPatients.value)} (${delta(k.newPatients)}) · Chờ thu: ${n(k.unpaidAmount)} (${n(k.unpaidCount)} phiếu)`,
      'Ghi nhận: theo ngày khám, sau chiết khấu. Thực thu: theo ngày thu, thu trừ hoàn tiền.',
    ],
    sections: [
      {
        title: 'So sánh chi nhánh',
        columns: [
          { header: 'Chi nhánh' },
          { header: 'Lượt khám', align: 'right' },
          { header: 'BN mới', align: 'right' },
          { header: 'Ghi nhận', align: 'right' },
          { header: 'Thực thu', align: 'right' },
          { header: 'Chờ thu', align: 'right' },
          { header: 'Chờ TB (phút)', align: 'right' },
          { header: 'Tái khám đã đến', align: 'right' },
          { header: 'Lãi gộp thuốc', align: 'right' },
        ],
        rows: report.rows.map((r) => [r.branchName, n(r.visits), n(r.newPatients), n(r.recognized), n(r.collected), n(r.unpaidAmount), dash(r.averageWaitMinutes), formatPercent(r.followUpArrivalPercent), n(r.drugMargin)]),
        totalRows: [[`Cộng ${report.rows.length} chi nhánh`, n(t.visits), n(t.newPatients), n(t.recognized), n(t.collected), n(t.unpaidAmount), dash(t.averageWaitMinutes), formatPercent(t.followUpArrivalPercent), n(t.drugMargin)]],
        emptyText: 'Không có chi nhánh nào trong phạm vi đã chọn.',
      },
      {
        title: 'Cơ cấu thực thu theo nhóm',
        columns: [{ header: 'Nhóm' }, { header: 'Thực thu', align: 'right' }, { header: 'Tỉ trọng', align: 'right' }],
        rows: report.groups.map((g) => [SYSTEM_GROUP_LABEL[g.group], n(g.amount), formatPercent(g.sharePercent)]),
        totalRows: [['Cộng', n(report.groupTotal), '']],
      },
      {
        title: 'Cần chú ý',
        columns: [{ header: 'Chi nhánh' }, { header: 'Nội dung' }],
        rows: report.alerts.map((a) => [a.branchName, a.text]),
        emptyText: 'Không có việc cần chú ý.',
      },
    ],
  };
}

export function buildSystemRankingPrintSpec(report: SystemRankingReport, ctx: SystemPrintContext): ReportPrintSpec {
  const branchColumns = report.branches.length > 1 ? report.branches.map((b) => ({ header: b.branchName, align: 'right' as const })) : [];
  const section = (kind: RankingKind, title: string) => {
    const cols = RANKING_COLUMNS[kind];
    return {
      title,
      columns: [{ header: 'Hạng', align: 'right' as const }, { header: 'Tên' }, { header: cols.subtitle }, { header: cols.quantity, align: 'right' as const }, { header: cols.total, align: 'right' as const }, ...branchColumns],
      rows: report[kind].map((r, i) => [String(i + 1), r.name, r.subtitle, n(r.quantity), n(r.total), ...(report.branches.length > 1 ? r.byBranch.map(n) : [])]),
      emptyText: cols.empty,
    };
  };
  return {
    title: 'Toàn hệ thống — Xếp hạng',
    subtitleLines: subtitle(ctx),
    infoLines: ['Mỗi bảng lấy 20 mục đầu của toàn phạm vi. Dịch vụ: doanh thu ghi nhận sau chiết khấu. Bác sĩ: doanh thu sinh ra. Thuốc và vật tư: lãi gộp.'],
    sections: [section('services', 'Dịch vụ'), section('doctors', 'Bác sĩ'), section('drugs', 'Thuốc và vật tư')],
  };
}

export function buildSystemMonthlyPrintSpec(report: SystemMonthlyReport, ctx: SystemPrintContext): ReportPrintSpec {
  const k = report.kpis;
  const sum = (key: 'visits' | 'newPatients' | 'recognized' | 'collected' | 'drugMargin', which: 'current' | 'previous') => report.rows.reduce((s, r) => s + r[which][key], 0);
  return {
    title: `Toàn hệ thống — Tổng hợp ${monthLabel(report.month).toLowerCase()}`,
    subtitleLines: subtitle(ctx, [`So với ${monthLabel(report.previousMonth).toLowerCase()}`]),
    infoLines: [
      `Ghi nhận: ${n(k.recognized.value)} (${formatSignedPercent(k.recognized.percent)}) · Thực thu: ${n(k.collected.value)} (${formatSignedPercent(k.collected.percent)}) · Lượt khám: ${n(k.visits.value)} (${formatSignedPercent(k.visits.percent)}) · Bệnh nhân mới: ${n(k.newPatients.value)} (${formatSignedPercent(k.newPatients.percent)}) · Lãi gộp thuốc: ${n(k.drugMargin.value)} (${formatSignedPercent(k.drugMargin.percent)})`,
    ],
    sections: [
      {
        title: 'Theo chi nhánh',
        columns: [
          { header: 'Chi nhánh' },
          { header: 'Lượt khám', align: 'right' },
          { header: 'BN mới', align: 'right' },
          { header: 'Ghi nhận', align: 'right' },
          { header: 'Thực thu', align: 'right' },
          { header: `Thực thu ${monthShort(report.previousMonth)}`, align: 'right' },
          { header: 'So tháng trước', align: 'right' },
          { header: 'Lãi gộp thuốc', align: 'right' },
        ],
        rows: report.rows.map((r) => [r.branchName, n(r.current.visits), n(r.current.newPatients), n(r.current.recognized), n(r.current.collected), n(r.previous.collected), formatSignedPercent(changePercent(r.current.collected, r.previous.collected)), n(r.current.drugMargin)]),
        totalRows: [[`Cộng ${report.rows.length} chi nhánh`, n(sum('visits', 'current')), n(sum('newPatients', 'current')), n(sum('recognized', 'current')), n(sum('collected', 'current')), n(sum('collected', 'previous')), formatSignedPercent(changePercent(sum('collected', 'current'), sum('collected', 'previous'))), n(sum('drugMargin', 'current'))]],
        emptyText: 'Không có chi nhánh nào trong phạm vi đã chọn.',
      },
      {
        title: 'Cơ cấu thực thu theo nhóm',
        columns: [{ header: 'Nhóm' }, { header: 'Thực thu', align: 'right' }, { header: 'Tỉ trọng', align: 'right' }],
        rows: report.groups.map((g) => [SYSTEM_GROUP_LABEL[g.group], n(g.amount), formatPercent(g.sharePercent)]),
        totalRows: [['Cộng', n(report.groupTotal), '']],
      },
      {
        title: `Xu hướng ${report.trend.length} tháng gần nhất`,
        columns: [{ header: 'Tháng' }, { header: 'Lượt khám', align: 'right' }, { header: 'BN mới', align: 'right' }, { header: 'Ghi nhận', align: 'right' }, { header: 'Thực thu', align: 'right' }],
        rows: report.trend.map((m) => [monthShort(m.month), n(m.visits), n(m.newPatients), n(m.recognized), n(m.collected)]),
      },
    ],
    signatures: ['Người lập', 'Quản lý', 'Chủ phòng khám'],
  };
}

export function buildSystemCrossPrintSpec(report: SystemCrossReport, ctx: SystemPrintContext): ReportPrintSpec {
  const t = report.totals;
  const capped = report.rowTotal > report.rows.length;
  return {
    title: 'Toàn hệ thống — Khám chéo chi nhánh',
    subtitleLines: subtitle(ctx),
    infoLines: [`Bệnh nhân có lượt khám: ${n(t.patientCount)} · Khám ở từ hai chi nhánh: ${n(t.crossPatientCount)} (${formatPercent(t.crossPercent)}) · Tổng lượt khám của nhóm này: ${n(t.crossVisits)}`, 'Lượt khám đã tiếp nhận trong kỳ. Báo cáo không hiện tiền theo bệnh nhân.'],
    sections: [
      {
        title: 'Theo cặp chi nhánh',
        columns: [{ header: 'Chi nhánh A' }, { header: 'Chi nhánh B' }, { header: 'Số bệnh nhân khám ở cả hai', align: 'right' }],
        rows: report.pairs.map((p) => [p.branchAName, p.branchBName, n(p.patientCount)]),
        emptyText: 'Không có bệnh nhân nào khám ở từ hai chi nhánh trong kỳ đã chọn.',
      },
      {
        title: 'Bệnh nhân khám chéo',
        columns: [{ header: 'Mã bệnh nhân' }, { header: 'Họ tên' }, { header: 'Số chi nhánh', align: 'right' }, { header: 'Số lượt', align: 'right' }, { header: 'Chi nhánh (số lượt)' }, { header: 'Khám gần nhất' }],
        rows: report.rows.map((r) => [r.patientCode, r.patientName, n(r.branchCount), n(r.visitCount), r.branches.map((b) => `${b.branchName} (${b.visits})`).join(', '), formatDobDisplay(r.lastVisitDate)]),
        emptyText: 'Không có bệnh nhân nào khám ở từ hai chi nhánh trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.rows.length)} bệnh nhân khám nhiều lượt nhất trong ${n(report.rowTotal)} bệnh nhân.` : undefined,
  };
}
