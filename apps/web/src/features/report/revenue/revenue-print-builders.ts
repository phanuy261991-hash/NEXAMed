import type { RevenueByCashierReport, RevenueByMethodReport, RevenueByPeriodReport, RevenueByServiceReport, RevenueUnpaidReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import { formatDateTimeVn } from '../../../shared/format/time';
import type { ReportPrintSpec } from '../../../shared/print/report-print-spec';
import { formatPercent } from '../operations/operations-model';
import { formatAgeDays, formatDeltaPercent, INVOICE_TYPE_LABEL, REVENUE_GROUP_BY_LABEL, REVENUE_GROUP_LABEL, REVENUE_GROUP_ORDER } from './revenue-model';

/**
 * Hàm THUẦN đổi báo cáo Doanh thu (đã tải trên màn hình) thành bản in A4 (docs/DECISIONS.md #287: mọi báo cáo phải in được trực tiếp). Không gọi API; `ReportTablePrintView` vẽ ra giấy qua loại
 * chứng từ `REPORT`. Số tiền không hậu tố "đ" (đơn vị đã rõ từ ngữ cảnh), cùng cách của các báo cáo đã có.
 */
interface PrintContext {
  from: string;
  to: string;
  /** "Quận 1, Quận 7" khi báo cáo gộp từ hai chi nhánh; `null` ở công ty/phạm vi một chi nhánh. */
  scopeLabel: string | null;
}

const n = (value: number): string => value.toLocaleString('vi-VN');
const period = (from: string, to: string): string => `Từ ${formatDobDisplay(from)} đến ${formatDobDisplay(to)}`;

function subtitle(ctx: PrintContext): string[] {
  return [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : [])];
}

export function buildRevenueByPeriodPrintSpec(report: RevenueByPeriodReport, ctx: PrintContext): ReportPrintSpec {
  const t = report.totals;
  const label = REVENUE_GROUP_BY_LABEL[report.groupBy];
  return {
    title: 'Doanh thu theo kỳ',
    subtitleLines: [...subtitle(ctx), `Gom theo: ${label}`],
    infoLines: [
      `Tổng ghi nhận: ${n(t.recognized)} · Thực thu: ${n(t.net)} · Chênh lệch: ${n(t.recognized - t.net)} · Chiết khấu đã cho: ${n(t.discount)} · Hoàn tiền: ${n(t.refunded)}`,
      'Ghi nhận: theo ngày khám, đã trừ chiết khấu. Thực thu: theo ngày thu, thu trừ hoàn tiền.',
    ],
    sections: [
      {
        columns: [
          { header: label },
          ...REVENUE_GROUP_ORDER.map((g) => ({ header: REVENUE_GROUP_LABEL[g], align: 'right' as const })),
          { header: 'Tổng ghi nhận', align: 'right' },
          { header: 'Chiết khấu', align: 'right' },
          { header: 'Hoàn tiền', align: 'right' },
          { header: 'Thực thu', align: 'right' },
          { header: 'So kỳ trước', align: 'right' },
        ],
        rows: report.rows.map((r) => [r.label, ...REVENUE_GROUP_ORDER.map((g) => n(r.byGroup[g])), n(r.recognized), n(r.discount), n(r.refunded), n(r.net), formatDeltaPercent(r.netDeltaPercent)]),
        totalRows: [['Cộng', ...REVENUE_GROUP_ORDER.map((g) => n(t.byGroup[g])), n(t.recognized), n(t.discount), n(t.refunded), n(t.net), '']],
        emptyText: 'Không có dữ liệu trong kỳ đã chọn.',
      },
    ],
  };
}

export function buildRevenueByServicePrintSpec(report: RevenueByServiceReport, ctx: PrintContext): ReportPrintSpec {
  const capped = report.rowTotal > report.rows.length;
  return {
    title: 'Doanh thu theo nhóm và dịch vụ',
    subtitleLines: subtitle(ctx),
    infoLines: [`Tổng ghi nhận: ${n(report.totalAmount)} (theo ngày khám, đã trừ chiết khấu)`],
    sections: [
      {
        title: 'Theo nhóm',
        columns: [{ header: 'Nhóm' }, { header: 'Số lượng', align: 'right' }, { header: 'Ghi nhận', align: 'right' }, { header: 'Tỉ trọng', align: 'right' }],
        rows: report.groups.map((g) => [REVENUE_GROUP_LABEL[g.group], n(g.quantity), n(g.amount), formatPercent(g.sharePercent)]),
        totalRows: [['Cộng', n(report.groups.reduce((s, g) => s + g.quantity, 0)), n(report.totalAmount), '']],
      },
      {
        title: 'Theo dịch vụ',
        columns: [{ header: 'Nhóm' }, { header: 'Dịch vụ' }, { header: 'Số lượng', align: 'right' }, { header: 'Số phiếu', align: 'right' }, { header: 'Ghi nhận', align: 'right' }, { header: 'Tỉ trọng', align: 'right' }],
        rows: report.rows.map((r) => [REVENUE_GROUP_LABEL[r.group], r.name, n(r.quantity), n(r.invoiceCount), n(r.amount), formatPercent(r.sharePercent)]),
        emptyText: 'Không có dịch vụ nào trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.rows.length)} dịch vụ có doanh thu cao nhất trong ${n(report.rowTotal)} dịch vụ.` : undefined,
  };
}

export function buildRevenueByMethodPrintSpec(report: RevenueByMethodReport, ctx: PrintContext): ReportPrintSpec {
  const t = report.totals;
  return {
    title: 'Doanh thu theo phương thức thanh toán',
    subtitleLines: subtitle(ctx),
    infoLines: [`Thực thu: ${n(t.net)} (thu ${n(t.collected)}, hoàn ${n(t.refunded)}) — theo ngày thu`],
    sections: [
      {
        columns: [{ header: 'Phương thức' }, { header: 'Lượt thu', align: 'right' }, { header: 'Tiền thu', align: 'right' }, { header: 'Lượt hoàn', align: 'right' }, { header: 'Tiền hoàn', align: 'right' }, { header: 'Thực thu', align: 'right' }, { header: 'Tỉ trọng', align: 'right' }],
        rows: report.rows.map((r) => [r.methodName, n(r.paymentCount), n(r.collected), n(r.refundCount), n(r.refunded), n(r.net), formatPercent(r.sharePercent)]),
        totalRows: [['Cộng', n(t.paymentCount), n(t.collected), n(t.refundCount), n(t.refunded), n(t.net), '']],
        emptyText: 'Không có khoản thu nào trong kỳ đã chọn.',
      },
    ],
  };
}

export function buildRevenueUnpaidPrintSpec(report: RevenueUnpaidReport, ctx: PrintContext): ReportPrintSpec {
  const multiBranch = report.branchCount > 1;
  const capped = report.totalCount > report.rows.length;
  return {
    title: 'Phiếu chưa thu',
    subtitleLines: subtitle(ctx),
    infoLines: [`Số phiếu chưa thu: ${n(report.totalCount)} · Tổng tiền: ${n(report.totalAmount)} · Phiếu cũ nhất: ${report.oldestAgeDays === null ? '—' : formatAgeDays(report.oldestAgeDays)}`],
    sections: [
      {
        title: 'Theo tuổi phiếu',
        columns: [{ header: 'Tuổi phiếu' }, { header: 'Số phiếu', align: 'right' }, { header: 'Số tiền', align: 'right' }],
        rows: report.aging.map((a) => [a.label, n(a.invoiceCount), n(a.amount)]),
        totalRows: [['Cộng', n(report.totalCount), n(report.totalAmount)]],
      },
      {
        title: 'Danh sách phiếu',
        columns: [
          { header: 'Số phiếu' },
          { header: 'Loại' },
          { header: 'Ngày khám' },
          { header: 'Tuổi', align: 'right' },
          { header: 'Bệnh nhân' },
          ...(multiBranch ? [{ header: 'Chi nhánh' }] : []),
          { header: 'Phải thu', align: 'right' as const },
        ],
        rows: report.rows.map((r) => [r.invoiceNo, INVOICE_TYPE_LABEL[r.invoiceType] ?? r.invoiceType, formatDobDisplay(r.date), formatAgeDays(r.ageDays), `${r.patientName} (${r.patientCode})`, ...(multiBranch ? [r.branchName] : []), n(r.amount)]),
        emptyText: 'Không có phiếu chưa thu trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.rows.length)} phiếu cũ nhất trong ${n(report.totalCount)} phiếu.` : undefined,
  };
}

export function buildRevenueByCashierPrintSpec(report: RevenueByCashierReport, ctx: PrintContext): ReportPrintSpec {
  const multiBranch = report.branchCount > 1;
  const t = report.totals;
  const capped = report.shiftTotal > report.shifts.length;
  const status = (s: RevenueByCashierReport['shifts'][number]) => (s.status === 'OPEN' ? 'Đang mở' : 'Đã chốt');
  return {
    title: 'Doanh thu theo thu ngân và chốt ca',
    subtitleLines: subtitle(ctx),
    infoLines: [`Thực thu: ${n(t.net)} · Số ca: ${n(t.shiftCount)} · Chênh lệch kiểm đếm: ${n(t.discrepancy)} (${n(t.discrepancyShiftCount)} ca lệch)`],
    sections: [
      {
        title: 'Theo thu ngân',
        columns: [{ header: 'Thu ngân' }, { header: 'Số ca', align: 'right' }, { header: 'Tiền thu', align: 'right' }, { header: 'Tiền hoàn', align: 'right' }, { header: 'Thực thu', align: 'right' }, { header: 'Chênh lệch', align: 'right' }, { header: 'Ca lệch', align: 'right' }],
        rows: report.cashiers.map((c) => [c.name, n(c.shiftCount), n(c.collected), n(c.refunded), n(c.net), n(c.discrepancy), n(c.discrepancyShiftCount)]),
        totalRows: [['Cộng', n(t.shiftCount), n(t.collected), n(t.refunded), n(t.net), n(t.discrepancy), n(t.discrepancyShiftCount)]],
        emptyText: 'Không có thanh toán hay ca thu ngân nào trong kỳ đã chọn.',
      },
      {
        title: 'Các ca thu ngân',
        columns: [
          { header: 'Số ca' },
          { header: 'Thu ngân' },
          ...(multiBranch ? [{ header: 'Chi nhánh' }] : []),
          { header: 'Mở lúc' },
          { header: 'Trạng thái' },
          { header: 'Dự kiến', align: 'right' as const },
          { header: 'Kiểm đếm', align: 'right' as const },
          { header: 'Chênh lệch', align: 'right' as const },
        ],
        rows: report.shifts.map((s) => [s.shiftNo, s.cashierName, ...(multiBranch ? [s.branchName] : []), formatDateTimeVn(s.openedAt), status(s), s.expectedCash === null ? '—' : n(s.expectedCash), s.countedCash === null ? '—' : n(s.countedCash), s.discrepancy === null ? '—' : n(s.discrepancy)]),
        emptyText: 'Không có ca thu ngân nào mở trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.shifts.length)} ca mới nhất trong ${n(report.shiftTotal)} ca.` : undefined,
  };
}
