import { SYSTEM_CROSS_ROW_LIMIT, SYSTEM_GROUP_LABEL } from '@nexamed/shared';
import type { SystemCrossReport, SystemMonthlyReport, SystemOverviewReport, SystemRankingReport } from '@nexamed/shared';
import { formatReportDate, type ReportExcelHeader } from '../../common/report-excel-header';
import { buildTableReportExcel, type ExcelCell } from '../../common/report-table-excel';
import type { OperationsExcelContext } from './operations-report-export';

/**
 * Bản Excel của trang báo cáo "Toàn hệ thống" (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel). Mỗi hàm đổi báo cáo đã tính (cùng số với màn hình) thành bảng Excel có đầu chuẩn; ô số ghi
 * SỐ để cộng/lọc được trong Excel. Không biết gì về truy vấn hay phạm vi — nhận ngữ cảnh đã dựng sẵn.
 */
export type SystemExcelContext = OperationsExcelContext;

const money = (value: number): string => value.toLocaleString('vi-VN');
const pct = (value: number | null): string => (value === null ? '—' : `${String(value).replace('.', ',')}%`);
const minutes = (value: number | null): string => (value === null ? '—' : String(value));
const delta = (value: number | null): string => (value === null ? '—' : `${value >= 0 ? '+' : ''}${String(value).replace('.', ',')}%`);
const periodText = (from: string, to: string): string => `${formatReportDate(from)} – ${formatReportDate(to)}`;

function header(ctx: SystemExcelContext, title: string, from: string, to: string): ReportExcelHeader {
  return { clinicName: ctx.clinicName, branchName: ctx.branchName, title, from, to, scopeLabel: ctx.scopeLabel, exportedByName: ctx.exportedByName, exportedAt: ctx.exportedAt };
}

export function buildSystemOverviewExcel(report: SystemOverviewReport, ctx: SystemExcelContext): Promise<Buffer> {
  const t = report.totals;
  const k = report.kpis;
  const branchColumns = report.daily.series.map((s) => ({ header: s.branchName, width: 16, numeric: true as const }));
  return buildTableReportExcel([
    {
      name: 'So sánh chi nhánh',
      header: header(ctx, 'Toàn hệ thống — So sánh chi nhánh', report.from, report.to),
      infoLines: [
        `So với kỳ trước: ${periodText(report.previousFrom, report.previousTo)}`,
        `Ghi nhận: ${money(k.recognized.value)} (${delta(k.recognized.percent)}) · Thực thu: ${money(k.collected.value)} (${delta(k.collected.percent)}) · Lượt khám: ${money(k.visits.value)} (${delta(k.visits.percent)}) · Bệnh nhân mới: ${money(k.newPatients.value)} (${delta(k.newPatients.percent)}) · Chờ thu: ${money(k.unpaidAmount)} (${k.unpaidCount} phiếu)`,
        'Ghi nhận: theo ngày khám, sau chiết khấu. Thực thu: theo ngày thu, thu trừ hoàn tiền. Bệnh nhân mới: lượt khám đầu tiên của bệnh nhân ở mọi chi nhánh rơi vào kỳ.',
      ],
      sections: [
        {
          title: 'So sánh chi nhánh',
          columns: [
            { header: 'Chi nhánh', width: 24 },
            { header: 'Lượt khám', width: 12, numeric: true },
            { header: 'BN mới', width: 10, numeric: true },
            { header: 'Ghi nhận', width: 18, numeric: true },
            { header: 'Thực thu', width: 18, numeric: true },
            { header: 'Chờ thu', width: 16, numeric: true },
            { header: 'Chờ TB (phút)', width: 14 },
            { header: 'Tái khám đã đến', width: 16 },
            { header: 'Lãi gộp thuốc', width: 18, numeric: true },
            { header: 'Lãi gộp dịch vụ', width: 18, numeric: true },
            { header: 'Lãi gộp tổng', width: 18, numeric: true },
          ],
          rows: report.rows.map((r) => [r.branchName, r.visits, r.newPatients, r.recognized, r.collected, r.unpaidAmount, minutes(r.averageWaitMinutes), pct(r.followUpArrivalPercent), r.drugMargin, r.serviceMargin, r.totalMargin]),
          totalRows: [[`Cộng ${report.rows.length} chi nhánh`, t.visits, t.newPatients, t.recognized, t.collected, t.unpaidAmount, minutes(t.averageWaitMinutes), pct(t.followUpArrivalPercent), t.drugMargin, t.serviceMargin, t.totalMargin]],
          emptyText: 'Không có chi nhánh nào trong phạm vi đã chọn.',
        },
        {
          title: 'Thực thu theo ngày, từng chi nhánh',
          columns: [{ header: 'Ngày', width: 13 }, ...branchColumns, { header: 'Cộng', width: 16, numeric: true }],
          rows: report.daily.dates.map((date, i): ExcelCell[] => [formatReportDate(date), ...report.daily.series.map((s) => s.values[i] ?? 0), report.daily.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)]),
          emptyText: 'Không có dữ liệu trong kỳ đã chọn.',
        },
        {
          title: 'Cơ cấu thực thu theo nhóm',
          columns: [{ header: 'Nhóm', width: 22 }, { header: 'Thực thu', width: 18, numeric: true }, { header: 'Tỉ trọng', width: 12 }],
          rows: report.groups.map((g) => [SYSTEM_GROUP_LABEL[g.group], g.amount, pct(g.sharePercent)]),
          totalRows: [['Cộng', report.groupTotal, '']],
        },
        {
          title: 'Cần chú ý',
          columns: [{ header: 'Chi nhánh', width: 24 }, { header: 'Nội dung', width: 60 }],
          rows: report.alerts.map((a) => [a.branchName, a.text]),
          emptyText: 'Không có việc cần chú ý.',
        },
      ],
    },
  ]);
}

export function buildSystemRankingExcel(report: SystemRankingReport, ctx: SystemExcelContext): Promise<Buffer> {
  const branchColumns = report.branches.map((b) => ({ header: b.branchName, width: 16, numeric: true as const }));
  const section = (title: string, quantityHeader: string, totalHeader: string, rows: SystemRankingReport['services'], emptyText: string) => ({
    title,
    columns: [{ header: 'Hạng', width: 7, numeric: true as const }, { header: 'Tên', width: 38 }, { header: 'Nhóm / Khoa', width: 20 }, { header: quantityHeader, width: 12, numeric: true as const }, { header: totalHeader, width: 18, numeric: true as const }, ...branchColumns],
    rows: rows.map((r, i): ExcelCell[] => [i + 1, r.name, r.subtitle, r.quantity, r.total, ...r.byBranch]),
    emptyText,
  });
  return buildTableReportExcel([
    {
      name: 'Xếp hạng',
      header: header(ctx, 'Toàn hệ thống — Xếp hạng', report.from, report.to),
      infoLines: ['Mỗi bảng lấy 20 mục đầu của toàn phạm vi, kèm giá trị từng chi nhánh. Dịch vụ: doanh thu ghi nhận sau chiết khấu. Bác sĩ: doanh thu sinh ra. Thuốc và vật tư: lãi gộp. Lãi gộp dịch vụ: doanh thu ghi nhận trừ chi phí vật tư tiêu hao của các lượt đã ghi tiêu hao.'],
      sections: [
        section('Dịch vụ', 'Số lượng', 'Ghi nhận', report.services, 'Không có dịch vụ nào trong kỳ đã chọn.'),
        section('Bác sĩ', 'Lượt khám', 'Doanh thu sinh ra', report.doctors, 'Không có bác sĩ nào khám trong kỳ đã chọn.'),
        section('Thuốc và vật tư', 'Số lượng', 'Lãi gộp', report.drugs, 'Không có thuốc hay vật tư nào được bán trong kỳ đã chọn.'),
        section('Lãi gộp dịch vụ', 'Số lượt', 'Lãi gộp dịch vụ', report.serviceMargins, 'Chưa có lượt dịch vụ nào ghi tiêu hao trong kỳ đã chọn.'),
      ],
    },
  ]);
}

export function buildSystemMonthlyExcel(report: SystemMonthlyReport, ctx: SystemExcelContext): Promise<Buffer> {
  const k = report.kpis;
  const monthLabel = (month: string) => `${month.slice(5)}/${month.slice(0, 4)}`;
  const sum = (key: 'visits' | 'newPatients' | 'recognized' | 'collected' | 'drugMargin' | 'serviceMargin' | 'totalMargin', which: 'current' | 'previous') => report.rows.reduce((s, r) => s + r[which][key], 0);
  const changeOf = (current: number, previous: number): string => (previous === 0 ? '—' : delta(Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10));
  return buildTableReportExcel([
    {
      name: 'Tổng hợp tháng',
      header: header(ctx, `Toàn hệ thống — Tổng hợp tháng ${monthLabel(report.month)}`, report.from, report.to),
      infoLines: [
        `So với tháng ${monthLabel(report.previousMonth)}`,
        `Ghi nhận: ${money(k.recognized.value)} (${delta(k.recognized.percent)}) · Thực thu: ${money(k.collected.value)} (${delta(k.collected.percent)}) · Lượt khám: ${money(k.visits.value)} (${delta(k.visits.percent)}) · Bệnh nhân mới: ${money(k.newPatients.value)} (${delta(k.newPatients.percent)}) · Lãi gộp thuốc: ${money(k.drugMargin.value)} (${delta(k.drugMargin.percent)}) · Lãi gộp dịch vụ: ${money(k.serviceMargin.value)} (${delta(k.serviceMargin.percent)}) · Lãi gộp tổng: ${money(k.totalMargin.value)} (${delta(k.totalMargin.percent)})`,
      ],
      sections: [
        {
          title: 'Theo chi nhánh',
          columns: [
            { header: 'Chi nhánh', width: 24 },
            { header: 'Lượt khám', width: 12, numeric: true },
            { header: 'BN mới', width: 10, numeric: true },
            { header: 'Ghi nhận', width: 18, numeric: true },
            { header: 'Thực thu', width: 18, numeric: true },
            { header: `Thực thu T${monthLabel(report.previousMonth)}`, width: 20, numeric: true },
            { header: 'So tháng trước', width: 14 },
            { header: 'Lãi gộp thuốc', width: 18, numeric: true },
            { header: 'Lãi gộp dịch vụ', width: 18, numeric: true },
            { header: 'Lãi gộp tổng', width: 18, numeric: true },
          ],
          rows: report.rows.map((r) => [r.branchName, r.current.visits, r.current.newPatients, r.current.recognized, r.current.collected, r.previous.collected, changeOf(r.current.collected, r.previous.collected), r.current.drugMargin, r.current.serviceMargin, r.current.totalMargin]),
          totalRows: [[`Cộng ${report.rows.length} chi nhánh`, sum('visits', 'current'), sum('newPatients', 'current'), sum('recognized', 'current'), sum('collected', 'current'), sum('collected', 'previous'), changeOf(sum('collected', 'current'), sum('collected', 'previous')), sum('drugMargin', 'current'), sum('serviceMargin', 'current'), sum('totalMargin', 'current')]],
          emptyText: 'Không có chi nhánh nào trong phạm vi đã chọn.',
        },
        {
          title: 'Cơ cấu thực thu theo nhóm',
          columns: [{ header: 'Nhóm', width: 22 }, { header: 'Thực thu', width: 18, numeric: true }, { header: 'Tỉ trọng', width: 12 }],
          rows: report.groups.map((g) => [SYSTEM_GROUP_LABEL[g.group], g.amount, pct(g.sharePercent)]),
          totalRows: [['Cộng', report.groupTotal, '']],
        },
        {
          title: `Xu hướng ${report.trend.length} tháng gần nhất`,
          columns: [{ header: 'Tháng', width: 12 }, { header: 'Lượt khám', width: 12, numeric: true }, { header: 'BN mới', width: 10, numeric: true }, { header: 'Ghi nhận', width: 18, numeric: true }, { header: 'Thực thu', width: 18, numeric: true }],
          rows: report.trend.map((m) => [monthLabel(m.month), m.visits, m.newPatients, m.recognized, m.collected]),
        },
      ],
    },
  ]);
}

export function buildSystemCrossExcel(report: SystemCrossReport, ctx: SystemExcelContext): Promise<Buffer> {
  const t = report.totals;
  const capped = report.rowTotal > report.rows.length;
  return buildTableReportExcel([
    {
      name: 'Khám chéo chi nhánh',
      header: header(ctx, 'Toàn hệ thống — Khám chéo chi nhánh', report.from, report.to),
      infoLines: [
        `Bệnh nhân có lượt khám: ${money(t.patientCount)} · Khám ở từ hai chi nhánh: ${money(t.crossPatientCount)} (${pct(t.crossPercent)}) · Tổng lượt khám của nhóm này: ${money(t.crossVisits)}`,
        'Lượt khám đã tiếp nhận trong kỳ. Báo cáo không hiện tiền theo bệnh nhân.',
      ],
      sections: [
        {
          title: 'Theo cặp chi nhánh',
          columns: [{ header: 'Chi nhánh A', width: 24 }, { header: 'Chi nhánh B', width: 24 }, { header: 'Số bệnh nhân khám ở cả hai', width: 26, numeric: true }],
          rows: report.pairs.map((p) => [p.branchAName, p.branchBName, p.patientCount]),
          emptyText: 'Không có bệnh nhân nào khám ở từ hai chi nhánh trong kỳ đã chọn.',
        },
        {
          title: 'Bệnh nhân khám chéo',
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Mã bệnh nhân', width: 16 },
            { header: 'Họ tên', width: 28 },
            { header: 'Số chi nhánh', width: 13, numeric: true },
            { header: 'Số lượt', width: 10, numeric: true },
            { header: 'Chi nhánh (số lượt)', width: 44 },
            { header: 'Khám gần nhất', width: 14 },
          ],
          rows: report.rows.map((r, i) => [i + 1, r.patientCode, r.patientName, r.branchCount, r.visitCount, r.branches.map((b) => `${b.branchName} (${b.visits})`).join(', '), formatReportDate(r.lastVisitDate)]),
          emptyText: 'Không có bệnh nhân nào khám ở từ hai chi nhánh trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${SYSTEM_CROSS_ROW_LIMIT.toLocaleString('vi-VN')} bệnh nhân khám nhiều lượt nhất trong ${report.rowTotal.toLocaleString('vi-VN')} bệnh nhân.` : undefined,
    },
  ]);
}
