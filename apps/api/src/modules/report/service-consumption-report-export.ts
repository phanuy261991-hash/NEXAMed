import { SERVICE_CONSUMPTION_REPORT_ENTRY_LIMIT, SERVICE_CONSUMPTION_REPORT_ROW_LIMIT } from '@nexamed/shared';
import type { ServiceConsumptionByCustomerReport, ServiceConsumptionByServiceReport } from '@nexamed/shared';
import { formatReportDate, type ReportExcelHeader } from '../../common/report-excel-header';
import { buildTableReportExcel } from '../../common/report-table-excel';
import type { OperationsExcelContext } from './operations-report-export';

/**
 * Bản Excel của báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, màn 9; #287: mọi báo cáo phải xuất được Excel). Cùng số với màn hình; ô số ghi SỐ để cộng/lọc được trong Excel.
 */
export type ServiceConsumptionExcelContext = OperationsExcelContext;

const money = (value: number): string => value.toLocaleString('vi-VN');
const NOTE = 'Chi phí vốn của vật tư và thuốc đã ghi tiêu hao theo từng lượt dịch vụ (giá vốn lô lúc xuất; phiếu đã đảo không tính). Không thu thêm tiền khách và không trừ vào lãi gộp.';

function header(ctx: ServiceConsumptionExcelContext, title: string, from: string, to: string): ReportExcelHeader {
  return { clinicName: ctx.clinicName, branchName: ctx.branchName, title, from, to, scopeLabel: ctx.scopeLabel, exportedByName: ctx.exportedByName, exportedAt: ctx.exportedAt };
}

function summaryLine(r: { totalCost: number; visitCount: number; averageCost: number | null }): string {
  return `Tổng chi phí vốn: ${money(r.totalCost)} · Số lượt dịch vụ: ${money(r.visitCount)} · Trung bình mỗi lượt: ${r.averageCost === null ? '—' : money(r.averageCost)}`;
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
            { header: 'Chi phí vốn', width: 18, numeric: true },
            { header: 'Trung bình / lượt', width: 18, numeric: true },
            { header: 'Dùng nhiều nhất', width: 40 },
          ],
          rows: report.rows.map((r, i) => [i + 1, r.name, r.visitCount, r.cost, r.averageCost ?? '', r.topItems.join(', ')]),
          totalRows: [['Cộng', `${report.serviceCount.toLocaleString('vi-VN')} dịch vụ`, report.visitCount, report.totalCost, report.averageCost ?? '', '']],
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
            { header: 'Chi phí vốn', width: 16, numeric: true },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
          ],
          rows: report.entries.map((e, i) => [i + 1, formatDateTime(e.occurredAt), e.patientCode, e.patientName, e.serviceName, e.itemsText, e.doctorName ?? '', e.performerName ?? '', e.cost, ...(multiBranch ? [e.branchName] : [])]),
          emptyText: 'Không có lượt dịch vụ nào ghi tiêu hao trong kỳ đã chọn.',
        },
      ],
      note: capped ? `Chỉ xuất ${SERVICE_CONSUMPTION_REPORT_ENTRY_LIMIT.toLocaleString('vi-VN')} lượt mới nhất trong ${report.entryCount.toLocaleString('vi-VN')} lượt.` : undefined,
    },
  ]);
}
