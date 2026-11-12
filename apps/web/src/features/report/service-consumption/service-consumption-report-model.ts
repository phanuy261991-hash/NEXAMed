import type { ServiceConsumptionByCustomerReport, ServiceConsumptionByServiceReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import type { ReportPrintSpec } from '../../../shared/print/report-print-spec';

/**
 * Phần THUẦN của báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, màn 9): thứ tự tab, hàm dựng bản in A4 (#287: mọi báo cáo phải in được trực tiếp). Không gọi API, không biết gì về giao diện.
 * Số tiền không hậu tố "đ" ở bảng (đơn vị đã rõ từ ngữ cảnh), cùng cách của các báo cáo đã có.
 */
export const SERVICE_CONSUMPTION_TABS = [
  { id: 'by-service', label: 'Theo dịch vụ' },
  { id: 'by-customer', label: 'Theo khách' },
] as const;

export type ServiceConsumptionTabId = (typeof SERVICE_CONSUMPTION_TABS)[number]['id'];

export const SERVICE_CONSUMPTION_DEFAULT_TAB: ServiceConsumptionTabId = 'by-service';

export function parseServiceConsumptionTab(raw: string | null): ServiceConsumptionTabId {
  return SERVICE_CONSUMPTION_TABS.find((t) => t.id === raw)?.id ?? SERVICE_CONSUMPTION_DEFAULT_TAB;
}

export interface ServiceConsumptionPrintContext {
  from: string;
  to: string;
  /** "Quận 1, Quận 7" khi báo cáo gộp từ hai chi nhánh; `null` ở phạm vi một chi nhánh. */
  scopeLabel: string | null;
}

const n = (value: number): string => value.toLocaleString('vi-VN');
const period = (from: string, to: string): string => `Từ ${formatDobDisplay(from)} đến ${formatDobDisplay(to)}`;
const NOTE = 'Chi phí vốn của vật tư và thuốc đã ghi tiêu hao theo từng lượt dịch vụ (giá vốn lô lúc xuất; phiếu đã đảo không tính). Không thu thêm tiền khách và không trừ vào lãi gộp.';

function summaryLine(r: { totalCost: number; visitCount: number; averageCost: number | null }): string {
  return `Tổng chi phí vốn: ${n(r.totalCost)} · Số lượt dịch vụ: ${n(r.visitCount)} · Trung bình mỗi lượt: ${r.averageCost === null ? '—' : n(r.averageCost)}`;
}

function formatDateTime(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString();
  return `${formatDobDisplay(vn.slice(0, 10))} ${vn.slice(11, 16)}`;
}

/** Dòng "Số X lượt trong Y" khi danh sách bị cắt bớt để không quá dài. */
export function truncatedNote(shown: number, total: number, unit: string): string | undefined {
  return total > shown ? `Hiện ${n(shown)} ${unit} đầu trong ${n(total)} ${unit}; dòng Cộng tính trên tất cả.` : undefined;
}

export function buildServiceConsumptionByServicePrintSpec(report: ServiceConsumptionByServiceReport, ctx: ServiceConsumptionPrintContext): ReportPrintSpec {
  const capped = report.serviceCount > report.rows.length;
  return {
    title: 'Chi phí vật tư theo dịch vụ',
    subtitleLines: [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : [])],
    infoLines: [summaryLine(report), NOTE],
    sections: [
      {
        columns: [
          { header: 'Dịch vụ' },
          { header: 'Số lượt', align: 'right' },
          { header: 'Chi phí vốn', align: 'right' },
          { header: 'Trung bình / lượt', align: 'right' },
          { header: 'Dùng nhiều nhất' },
        ],
        rows: report.rows.map((r) => [r.name, n(r.visitCount), n(r.cost), r.averageCost === null ? '—' : n(r.averageCost), r.topItems.join(', ')]),
        totalRows: [[`Cộng ${n(report.serviceCount)} dịch vụ`, n(report.visitCount), n(report.totalCost), report.averageCost === null ? '—' : n(report.averageCost), '']],
        emptyText: 'Không có vật tư hay thuốc nào được ghi tiêu hao trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.rows.length)} dịch vụ tốn nhiều nhất trong ${n(report.serviceCount)} dịch vụ; dòng Cộng tính trên tất cả.` : undefined,
  };
}

export function buildServiceConsumptionByCustomerPrintSpec(report: ServiceConsumptionByCustomerReport, ctx: ServiceConsumptionPrintContext): ReportPrintSpec {
  const capped = report.entryCount > report.entries.length;
  const multiBranch = report.branchCount > 1;
  return {
    title: 'Chi phí vật tư theo khách',
    subtitleLines: [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : [])],
    infoLines: [summaryLine(report), NOTE],
    sections: [
      {
        columns: [
          { header: 'Ngày giờ' },
          { header: 'Khách' },
          { header: 'Dịch vụ' },
          { header: 'Vật tư và thuốc đã dùng' },
          { header: 'Bác sĩ' },
          { header: 'Người thực hiện' },
          { header: 'Chi phí vốn', align: 'right' },
          ...(multiBranch ? [{ header: 'Chi nhánh' }] : []),
        ],
        rows: report.entries.map((e) => [formatDateTime(e.occurredAt), `${e.patientName} (${e.patientCode})`, e.serviceName, e.itemsText, e.doctorName ?? '—', e.performerName ?? '—', n(e.cost), ...(multiBranch ? [e.branchName] : [])]),
        emptyText: 'Không có lượt dịch vụ nào ghi tiêu hao trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.entries.length)} lượt mới nhất trong ${n(report.entryCount)} lượt.` : undefined,
  };
}

export { formatDateTime as formatConsumptionDateTime };
