import { SERVICE_CONSUMPTION_REPORT_ENTRY_LIMIT, SERVICE_CONSUMPTION_REPORT_ROW_LIMIT } from '@nexamed/shared';
import type { ServiceConsumptionByBranchReport, ServiceConsumptionByCustomerReport, ServiceConsumptionByItemReport, ServiceConsumptionByServiceReport } from '@nexamed/shared';
import { formatReportDate, type ReportExcelHeader } from '../../common/report-excel-header';
import { buildTableReportExcel } from '../../common/report-table-excel';
import type { OperationsExcelContext } from './operations-report-export';

/**
 * Bản Excel của báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, màn 9; #287: mọi báo cáo phải xuất được Excel; #297 bổ sung 4: thêm doanh thu, lãi gộp và hai tab Theo vật tư,
 * Theo chi nhánh). Cùng số với màn hình; ô số ghi SỐ để cộng/lọc được trong Excel.
 */
export type ServiceConsumptionExcelContext = OperationsExcelContext;

const money = (value: number): string => value.toLocaleString('vi-VN');
const percent = (value: number | null): string => (value === null ? '—' : `${value.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const NOTE =
  'Chi phí vốn của vật tư và thuốc đã ghi tiêu hao theo từng lượt dịch vụ (giá vốn lô lúc xuất; phiếu đã đảo không tính). Doanh thu là số ghi nhận sau chiết khấu của các lượt đã ghi tiêu hao; lãi gộp dịch vụ là doanh thu trừ chi phí vốn, chưa trừ nhân sự, mặt bằng, khấu hao. Không thu thêm tiền khách.';

function header(ctx: ServiceConsumptionExcelContext, title: string, from: string, to: string): ReportExcelHeader {
  return { clinicName: ctx.clinicName, branchName: ctx.branchName, title, from, to, scopeLabel: ctx.scopeLabel, exportedByName: ctx.exportedByName, exportedAt: ctx.exportedAt };
}

function summaryLine(r: { totalCost: number; totalRevenue: number; totalMargin: number; marginPercent: number | null; visitCount: number; averageCost: number | null }): string {
  return `Tổng chi phí vốn: ${money(r.totalCost)} · Doanh thu dịch vụ: ${money(r.totalRevenue)} · Lãi gộp dịch vụ: ${money(r.totalMargin)} (biên ${percent(r.marginPercent)}) · Số lượt dịch vụ: ${money(r.visitCount)} · Trung bình mỗi lượt: ${r.averageCost === null ? '—' : money(r.averageCost)}`;
}

function formatDateTime(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString();
  return `${formatReportDate(vn.slice(0, 10))} ${vn.slice(11, 16)}`;
}

export function buildServiceConsumptionByServiceExcel(report: ServiceConsumptionByServiceReport, ctx: ServiceConsumptionExcelContext): Promise<Buffer> {
  const capped = report.serviceCount > report.rows.length;
  return buildTableReportExcel([
    {
      name: 'Theo dịch vụ',
      header: header(ctx, 'Chi phí vật tư theo dịch vụ', report.from, report.to),
      infoLines: [summaryLine(report), NOTE],
      sections: [
        {
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Dịch vụ', width: 38 },
            { header: 'Số lượt', width: 12, numeric: true },
            { header: 'Doanh thu', width: 18, numeric: true },
            { header: 'Chi phí vốn', width: 18, numeric: true },
            { header: 'Trung bình / lượt', width: 18, numeric: true },
            { header: 'Lãi gộp', width: 18, numeric: true },
            { header: 'Biên lãi gộp', width: 14 },
            { header: 'Dùng nhiều nhất', width: 40 },
          ],
          rows: report.rows.map((r, i) => [i + 1, r.name, r.visitCount, r.revenue, r.cost, r.averageCost ?? '', r.margin, percent(r.marginPercent), r.topItems.join(', ')]),
          totalRows: [['Cộng', `${report.serviceCount.toLocaleString('vi-VN')} dịch vụ`, report.visitCount, report.totalRevenue, report.totalCost, report.averageCost ?? '', report.totalMargin, percent(report.marginPercent), '']],
          emptyText: 'Không có vật tư hay thuốc nào được ghi tiêu hao trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${SERVICE_CONSUMPTION_REPORT_ROW_LIMIT.toLocaleString('vi-VN')} dịch vụ tốn nhiều nhất trong ${report.serviceCount.toLocaleString('vi-VN')} dịch vụ; dòng Cộng tính trên tất cả.` : undefined,
    },
  ]);
}

export function buildServiceConsumptionByCustomerExcel(report: ServiceConsumptionByCustomerReport, multiBranch: boolean, ctx: ServiceConsumptionExcelContext): Promise<Buffer> {
  const capped = report.entryCount > report.entries.length;
  return buildTableReportExcel([
    {
      name: 'Theo khách',
      header: header(ctx, 'Chi phí vật tư theo khách', report.from, report.to),
      infoLines: [summaryLine(report), NOTE],
      sections: [
        {
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Ngày giờ', width: 18 },
            { header: 'Mã bệnh nhân', width: 16 },
            { header: 'Khách', width: 26 },
            { header: 'Dịch vụ', width: 30 },
            { header: 'Vật tư và thuốc đã dùng', width: 46 },
            { header: 'Bác sĩ', width: 22 },
            { header: 'Người thực hiện', width: 22 },
            { header: 'Doanh thu', width: 16, numeric: true },
            { header: 'Chi phí vốn', width: 16, numeric: true },
            { header: 'Lãi gộp', width: 16, numeric: true },
            { header: 'Ghi chú', width: 16 },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
          ],
          rows: report.entries.map((e, i) => [
            i + 1,
            formatDateTime(e.occurredAt),
            e.patientCode,
            e.patientName,
            e.serviceName,
            e.itemsText,
            e.doctorName ?? '',
            e.performerName ?? '',
            e.revenue,
            e.cost,
            e.margin,
            e.refunded ? 'Đã hoàn tiền' : '',
            ...(multiBranch ? [e.branchName] : []),
          ]),
          totalRows: capped ? undefined : [['Cộng', '', '', '', '', '', '', '', report.totalRevenue, report.totalCost, report.totalMargin, '', ...(multiBranch ? [''] : [])]],
          emptyText: 'Không có lượt dịch vụ nào ghi tiêu hao trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${SERVICE_CONSUMPTION_REPORT_ENTRY_LIMIT.toLocaleString('vi-VN')} lượt mới nhất trong ${report.entryCount.toLocaleString('vi-VN')} lượt; tổng đầu trang tính trên tất cả.` : undefined,
    },
  ]);
}

export function buildServiceConsumptionByItemExcel(report: ServiceConsumptionByItemReport, ctx: ServiceConsumptionExcelContext): Promise<Buffer> {
  const capped = report.itemCount > report.rows.length;
  return buildTableReportExcel([
    {
      name: 'Theo vật tư',
      header: header(ctx, 'Chi phí vật tư theo mặt hàng', report.from, report.to),
      infoLines: [`Tổng chi phí vốn: ${money(report.totalCost)} · Số mặt hàng đã dùng: ${money(report.itemCount)} (${money(report.supplyCount)} vật tư, ${money(report.medicineCount)} thuốc)`, NOTE],
      sections: [
        {
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Mặt hàng', width: 38 },
            { header: 'Loại', width: 12 },
            { header: 'Dùng ở', width: 42 },
            { header: 'Số lượng', width: 14, numeric: true },
            { header: 'Đơn vị', width: 12 },
            { header: 'Giá vốn TB / đơn vị', width: 20, numeric: true },
            { header: 'Chi phí vốn', width: 18, numeric: true },
            { header: 'Tỷ trọng', width: 12 },
          ],
          rows: report.rows.map((r, i) => [
            i + 1,
            r.name,
            r.itemType === 'MEDICINE' ? 'Thuốc' : 'Vật tư',
            r.serviceNames.join(', ') + (r.serviceCount > r.serviceNames.length ? ` và ${r.serviceCount - r.serviceNames.length} dịch vụ khác` : ''),
            r.quantity,
            r.unitName,
            r.averageUnitCost ?? '',
            r.cost,
            percent(r.sharePercent),
          ]),
          totalRows: [['Cộng', `${report.itemCount.toLocaleString('vi-VN')} mặt hàng`, '', '', '', '', '', report.totalCost, report.totalCost > 0 ? percent(100) : '—']],
          emptyText: 'Không có vật tư hay thuốc nào được ghi tiêu hao trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${SERVICE_CONSUMPTION_REPORT_ROW_LIMIT.toLocaleString('vi-VN')} mặt hàng tốn nhiều nhất trong ${report.itemCount.toLocaleString('vi-VN')} mặt hàng; dòng Cộng chỉ cộng các dòng đã xuất.` : undefined,
    },
  ]);
}

export function buildServiceConsumptionByBranchExcel(report: ServiceConsumptionByBranchReport, ctx: ServiceConsumptionExcelContext): Promise<Buffer> {
  return buildTableReportExcel([
    {
      name: 'Theo chi nhánh',
      header: header(ctx, 'Chi phí vật tư từng chi nhánh', report.from, report.to),
      infoLines: [summaryLine(report), NOTE],
      sections: [
        {
          columns: [
            { header: 'STT', width: 7, numeric: true },
            { header: 'Chi nhánh', width: 32 },
            { header: 'Số lượt', width: 12, numeric: true },
            { header: 'Doanh thu', width: 18, numeric: true },
            { header: 'Chi phí vốn', width: 18, numeric: true },
            { header: 'Trung bình / lượt', width: 18, numeric: true },
            { header: 'Lãi gộp', width: 18, numeric: true },
            { header: 'Biên lãi gộp', width: 14 },
          ],
          rows: report.rows.map((r, i) => [i + 1, r.branchName, r.visitCount, r.revenue, r.cost, r.averageCost ?? '', r.margin, percent(r.marginPercent)]),
          totalRows: [[`Cộng`, `${report.rows.length.toLocaleString('vi-VN')} chi nhánh`, report.visitCount, report.totalRevenue, report.totalCost, report.averageCost ?? '', report.totalMargin, percent(report.marginPercent)]],
          emptyText: 'Không có chi nhánh nào trong phạm vi đã chọn.',
        },
      ],
    },
  ]);
}
