import { REVENUE_GROUP_LABEL } from '@nexamed/core';
import type { RevenueByCashierReport, RevenueByMethodReport, RevenueByPeriodReport, RevenueByServiceReport, RevenueGroupByCode, RevenueUnpaidReport } from '@nexamed/shared';
import { REVENUE_SHIFT_ROW_LIMIT, REVENUE_UNPAID_ROW_LIMIT } from '@nexamed/shared';
import { formatReportDate, formatReportDateTime, type ReportExcelHeader } from '../../common/report-excel-header';
import { buildTableReportExcel } from '../../common/report-table-excel';
import type { OperationsExcelContext } from './operations-report-export';
import { REVENUE_SERVICE_ROW_LIMIT } from './revenue-report.service';

/**
 * Bản Excel của trang báo cáo "Doanh thu" (docs/DECISIONS.md #287: mọi báo cáo phải xuất được Excel). Mỗi hàm đổi báo cáo đã tính (cùng số với màn hình) thành bảng Excel có đầu chuẩn; ô số ghi
 * SỐ (đồng) để cộng/lọc được trong Excel. Không biết gì về truy vấn hay phạm vi — nhận ngữ cảnh đã dựng sẵn.
 */
export type RevenueExcelContext = OperationsExcelContext;

const PERIOD_LABEL: Record<RevenueGroupByCode, string> = { day: 'Ngày', week: 'Tuần', month: 'Tháng', quarter: 'Quý' };
const INVOICE_TYPE_LABEL: Record<string, string> = { SERVICE: 'Dịch vụ khám', DRUG: 'Thuốc', PARACLINICAL: 'Cận lâm sàng' };
const pct = (value: number | null): string => (value === null ? '—' : `${String(value).replace('.', ',')}%`);
const money = (value: number): string => value.toLocaleString('vi-VN');

function header(ctx: RevenueExcelContext, title: string, from: string, to: string): ReportExcelHeader {
  return { clinicName: ctx.clinicName, branchName: ctx.branchName, title, from, to, scopeLabel: ctx.scopeLabel, exportedByName: ctx.exportedByName, exportedAt: ctx.exportedAt };
}

export function buildRevenueByPeriodExcel(report: RevenueByPeriodReport, ctx: RevenueExcelContext): Promise<Buffer> {
  const t = report.totals;
  return buildTableReportExcel([
    {
      name: 'Doanh thu theo kỳ',
      header: header(ctx, 'Doanh thu theo kỳ', report.from, report.to),
      infoLines: [
        `Gom theo: ${PERIOD_LABEL[report.groupBy]}`,
        'Ghi nhận: theo ngày khám, đã trừ chiết khấu. Thực thu: theo ngày thu, thu trừ hoàn tiền.',
        `Tổng ghi nhận: ${money(t.recognized)} · Thực thu: ${money(t.net)} · Chênh lệch: ${money(t.recognized - t.net)} · Chiết khấu: ${money(t.discount)} · Hoàn tiền: ${money(t.refunded)}`,
      ],
      sections: [
        {
          columns: [
            { header: PERIOD_LABEL[report.groupBy], width: 16 },
            { header: REVENUE_GROUP_LABEL.EXAM, width: 16, numeric: true },
            { header: REVENUE_GROUP_LABEL.PARACLINICAL, width: 16, numeric: true },
            { header: REVENUE_GROUP_LABEL.DRUG, width: 16, numeric: true },
            { header: REVENUE_GROUP_LABEL.PACKAGE, width: 16, numeric: true },
            { header: 'Tổng ghi nhận', width: 18, numeric: true },
            { header: 'Chiết khấu', width: 16, numeric: true },
            { header: 'Hoàn tiền', width: 16, numeric: true },
            { header: 'Thực thu', width: 18, numeric: true },
            { header: 'So kỳ trước', width: 14 },
          ],
          rows: report.rows.map((r) => [r.label, r.byGroup.EXAM, r.byGroup.PARACLINICAL, r.byGroup.DRUG, r.byGroup.PACKAGE, r.recognized, r.discount, r.refunded, r.net, r.netDeltaPercent === null ? '—' : `${r.netDeltaPercent >= 0 ? '+' : ''}${String(r.netDeltaPercent).replace('.', ',')}%`]),
          totalRows: [['Cộng', t.byGroup.EXAM, t.byGroup.PARACLINICAL, t.byGroup.DRUG, t.byGroup.PACKAGE, t.recognized, t.discount, t.refunded, t.net, '']],
          emptyText: 'Không có dữ liệu trong kỳ đã chọn.',
        },
      ],
    },
  ]);
}

export function buildRevenueByServiceExcel(report: RevenueByServiceReport, ctx: RevenueExcelContext): Promise<Buffer> {
  const capped = report.rowTotal > report.rows.length;
  return buildTableReportExcel([
    {
      name: 'Theo nhóm và dịch vụ',
      header: header(ctx, 'Doanh thu theo nhóm và dịch vụ', report.from, report.to),
      infoLines: [`Tổng ghi nhận: ${money(report.totalAmount)} (theo ngày khám, đã trừ chiết khấu)`],
      sections: [
        {
          title: 'Theo nhóm',
          columns: [{ header: 'Nhóm', width: 20 }, { header: 'Số lượng', width: 12, numeric: true }, { header: 'Ghi nhận', width: 18, numeric: true }, { header: 'Tỉ trọng', width: 12 }],
          rows: report.groups.map((g) => [REVENUE_GROUP_LABEL[g.group], g.quantity, g.amount, pct(g.sharePercent)]),
          totalRows: [['Cộng', report.groups.reduce((s, g) => s + g.quantity, 0), report.totalAmount, '']],
        },
        {
          title: 'Theo dịch vụ',
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Nhóm', width: 18 },
            { header: 'Mã', width: 16 },
            { header: 'Tên dịch vụ', width: 44 },
            { header: 'Số lượng', width: 12, numeric: true },
            { header: 'Số phiếu', width: 12, numeric: true },
            { header: 'Ghi nhận', width: 18, numeric: true },
            { header: 'Tỉ trọng', width: 12 },
          ],
          rows: report.rows.map((r, i) => [i + 1, REVENUE_GROUP_LABEL[r.group], r.code, r.name, r.quantity, r.invoiceCount, r.amount, pct(r.sharePercent)]),
          emptyText: 'Không có dịch vụ nào trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${REVENUE_SERVICE_ROW_LIMIT.toLocaleString('vi-VN')} dịch vụ có doanh thu cao nhất trong ${report.rowTotal.toLocaleString('vi-VN')} dịch vụ.` : undefined,
    },
  ]);
}

export function buildRevenueByMethodExcel(report: RevenueByMethodReport, ctx: RevenueExcelContext): Promise<Buffer> {
  const t = report.totals;
  return buildTableReportExcel([
    {
      name: 'Theo phương thức',
      header: header(ctx, 'Doanh thu theo phương thức thanh toán', report.from, report.to),
      infoLines: ['Thực thu theo ngày thu: thu trừ hoàn tiền.'],
      sections: [
        {
          columns: [
            { header: 'Phương thức', width: 26 },
            { header: 'Số lượt thu', width: 14, numeric: true },
            { header: 'Tiền thu', width: 18, numeric: true },
            { header: 'Số lượt hoàn', width: 14, numeric: true },
            { header: 'Tiền hoàn', width: 18, numeric: true },
            { header: 'Thực thu', width: 18, numeric: true },
            { header: 'Tỉ trọng', width: 12 },
          ],
          rows: report.rows.map((r) => [r.methodName, r.paymentCount, r.collected, r.refundCount, r.refunded, r.net, pct(r.sharePercent)]),
          totalRows: [['Cộng', t.paymentCount, t.collected, t.refundCount, t.refunded, t.net, '']],
          emptyText: 'Không có khoản thu nào trong kỳ đã chọn.',
        },
      ],
    },
  ]);
}

export function buildRevenueUnpaidExcel(report: RevenueUnpaidReport, multiBranch: boolean, ctx: RevenueExcelContext): Promise<Buffer> {
  const capped = report.totalCount > report.rows.length;
  return buildTableReportExcel([
    {
      name: 'Phiếu chưa thu',
      header: header(ctx, 'Phiếu chưa thu', report.from, report.to),
      infoLines: [`Số phiếu chưa thu: ${report.totalCount.toLocaleString('vi-VN')} · Tổng tiền: ${money(report.totalAmount)} · Cũ nhất: ${report.oldestAgeDays === null ? '—' : `${report.oldestAgeDays} ngày`}`, 'Ngày khám trong kỳ đã chọn; số tiền là số phải thu sau chiết khấu.'],
      sections: [
        {
          title: 'Theo tuổi phiếu',
          columns: [{ header: 'Tuổi phiếu', width: 20 }, { header: 'Số phiếu', width: 12, numeric: true }, { header: 'Số tiền', width: 18, numeric: true }],
          rows: report.aging.map((a) => [a.label, a.invoiceCount, a.amount]),
          totalRows: [['Cộng', report.totalCount, report.totalAmount]],
        },
        {
          title: 'Danh sách phiếu',
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Số phiếu', width: 18 },
            { header: 'Loại', width: 16 },
            { header: 'Ngày khám', width: 13 },
            { header: 'Số ngày', width: 10, numeric: true },
            { header: 'Mã bệnh nhân', width: 16 },
            { header: 'Họ tên', width: 26 },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
            { header: 'Phải thu', width: 16, numeric: true },
          ],
          rows: report.rows.map((r, i) => [i + 1, r.invoiceNo, INVOICE_TYPE_LABEL[r.invoiceType] ?? r.invoiceType, formatReportDate(r.date), r.ageDays, r.patientCode, r.patientName, ...(multiBranch ? [r.branchName] : []), r.amount]),
          emptyText: 'Không có phiếu chưa thu trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${REVENUE_UNPAID_ROW_LIMIT.toLocaleString('vi-VN')} phiếu cũ nhất trong ${report.totalCount.toLocaleString('vi-VN')} phiếu.` : undefined,
    },
  ]);
}

export function buildRevenueByCashierExcel(report: RevenueByCashierReport, multiBranch: boolean, ctx: RevenueExcelContext): Promise<Buffer> {
  const t = report.totals;
  const capped = report.shiftTotal > report.shifts.length;
  return buildTableReportExcel([
    {
      name: 'Theo thu ngân và chốt ca',
      header: header(ctx, 'Doanh thu theo thu ngân và chốt ca', report.from, report.to),
      infoLines: ['Thu ngân là người ghi nhận khoản thanh toán. Chênh lệch = kiểm đếm − dự kiến của các ca đã chốt (ca mở trong kỳ).'],
      sections: [
        {
          title: 'Theo thu ngân',
          columns: [
            { header: 'Thu ngân', width: 26 },
            { header: 'Số ca', width: 10, numeric: true },
            { header: 'Số lượt thanh toán', width: 18, numeric: true },
            { header: 'Tiền thu', width: 18, numeric: true },
            { header: 'Tiền hoàn', width: 18, numeric: true },
            { header: 'Thực thu', width: 18, numeric: true },
            { header: 'Chênh lệch kiểm đếm', width: 20, numeric: true },
            { header: 'Số ca lệch', width: 12, numeric: true },
          ],
          rows: report.cashiers.map((c) => [c.name, c.shiftCount, c.paymentCount, c.collected, c.refunded, c.net, c.discrepancy, c.discrepancyShiftCount]),
          totalRows: [['Cộng', t.shiftCount, report.cashiers.reduce((s, c) => s + c.paymentCount, 0), t.collected, t.refunded, t.net, t.discrepancy, t.discrepancyShiftCount]],
          emptyText: 'Không có thanh toán hay ca thu ngân nào trong kỳ đã chọn.',
        },
        {
          title: 'Các ca thu ngân',
          columns: [
            { header: 'Số ca', width: 16 },
            { header: 'Ca', width: 12 },
            { header: 'Thu ngân', width: 24 },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
            { header: 'Mở lúc', width: 18 },
            { header: 'Chốt lúc', width: 18 },
            { header: 'Trạng thái', width: 12 },
            { header: 'Dự kiến', width: 16, numeric: true },
            { header: 'Kiểm đếm', width: 16, numeric: true },
            { header: 'Chênh lệch', width: 16, numeric: true },
          ],
          rows: report.shifts.map((s) => [s.shiftNo, s.label, s.cashierName, ...(multiBranch ? [s.branchName] : []), formatReportDateTime(new Date(s.openedAt)), s.closedAt ? formatReportDateTime(new Date(s.closedAt)) : '', s.status === 'OPEN' ? 'Đang mở' : 'Đã chốt', s.expectedCash, s.countedCash, s.discrepancy]),
          emptyText: 'Không có ca thu ngân nào mở trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${REVENUE_SHIFT_ROW_LIMIT.toLocaleString('vi-VN')} ca mới nhất trong ${report.shiftTotal.toLocaleString('vi-VN')} ca.` : undefined,
    },
  ]);
}
