import type { ServiceConsumptionByBranchReport, ServiceConsumptionByCustomerReport, ServiceConsumptionByItemReport, ServiceConsumptionByServiceReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import type { ReportPrintSpec } from '../../../shared/print/report-print-spec';

/**
 * Phần THUẦN của báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, màn 9; #297 bổ sung 4): thứ tự tab, hàm dựng bản in A4 (#287: mọi báo cáo phải in được trực tiếp). Không gọi API,
 * không biết gì về giao diện. Số tiền không hậu tố "đ" ở bảng (đơn vị đã rõ từ ngữ cảnh), cùng cách của các báo cáo đã có.
 */
export const SERVICE_CONSUMPTION_TABS = [
  { id: 'by-service', label: 'Theo dịch vụ' },
  { id: 'by-customer', label: 'Theo khách' },
  { id: 'by-item', label: 'Theo vật tư' },
  { id: 'by-branch', label: 'Theo chi nhánh' },
] as const;

export type ServiceConsumptionTabId = (typeof SERVICE_CONSUMPTION_TABS)[number]['id'];

export const SERVICE_CONSUMPTION_DEFAULT_TAB: ServiceConsumptionTabId = 'by-service';

/** Tab "Theo chi nhánh" chỉ có khi tài khoản chọn được phạm vi nhiều chi nhánh (công ty một chi nhánh: giao diện không đổi, #231). */
export function visibleServiceConsumptionTabs(canChooseBranches: boolean) {
  return SERVICE_CONSUMPTION_TABS.filter((t) => t.id !== 'by-branch' || canChooseBranches);
}

export function parseServiceConsumptionTab(raw: string | null, canChooseBranches = true): ServiceConsumptionTabId {
  return visibleServiceConsumptionTabs(canChooseBranches).find((t) => t.id === raw)?.id ?? SERVICE_CONSUMPTION_DEFAULT_TAB;
}

export interface ServiceConsumptionPrintContext {
  from: string;
  to: string;
  /** "Quận 1, Quận 7" khi báo cáo gộp từ hai chi nhánh; `null` ở phạm vi một chi nhánh. */
  scopeLabel: string | null;
}

const n = (value: number): string => value.toLocaleString('vi-VN');
const percent = (value: number | null): string => (value === null ? '—' : `${String(value).replace('.', ',')}%`);
const period = (from: string, to: string): string => `Từ ${formatDobDisplay(from)} đến ${formatDobDisplay(to)}`;
const NOTE =
  'Chi phí vốn của vật tư và thuốc đã ghi tiêu hao theo từng lượt dịch vụ (giá vốn lô lúc xuất; phiếu đã đảo không tính). Doanh thu là số ghi nhận sau chiết khấu của các lượt đã ghi tiêu hao; lãi gộp dịch vụ là doanh thu trừ chi phí vốn, chưa trừ nhân sự, mặt bằng, khấu hao. Không thu thêm tiền khách.';

interface SummaryFields {
  totalCost: number;
  totalRevenue: number;
  totalMargin: number;
  marginPercent: number | null;
  visitCount: number;
  averageCost: number | null;
}

function summaryLine(r: SummaryFields): string {
  return `Tổng chi phí vốn: ${n(r.totalCost)} · Doanh thu dịch vụ: ${n(r.totalRevenue)} · Lãi gộp dịch vụ: ${n(r.totalMargin)} (biên ${percent(r.marginPercent)}) · Số lượt dịch vụ: ${n(r.visitCount)} · Trung bình mỗi lượt: ${r.averageCost === null ? '—' : n(r.averageCost)}`;
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
          { header: 'Doanh thu', align: 'right' },
          { header: 'Chi phí vốn', align: 'right' },
          { header: 'Trung bình / lượt', align: 'right' },
          { header: 'Lãi gộp', align: 'right' },
          { header: 'Biên', align: 'right' },
          { header: 'Dùng nhiều nhất' },
        ],
        rows: report.rows.map((r) => [r.name, n(r.visitCount), n(r.revenue), n(r.cost), r.averageCost === null ? '—' : n(r.averageCost), n(r.margin), percent(r.marginPercent), r.topItems.join(', ')]),
        totalRows: [[`Cộng ${n(report.serviceCount)} dịch vụ`, n(report.visitCount), n(report.totalRevenue), n(report.totalCost), report.averageCost === null ? '—' : n(report.averageCost), n(report.totalMargin), percent(report.marginPercent), '']],
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
          { header: 'Doanh thu', align: 'right' },
          { header: 'Chi phí vốn', align: 'right' },
          { header: 'Lãi gộp', align: 'right' },
          ...(multiBranch ? [{ header: 'Chi nhánh' }] : []),
        ],
        rows: report.entries.map((e) => [
          formatDateTime(e.occurredAt),
          `${e.patientName} (${e.patientCode})`,
          e.serviceName,
          e.itemsText,
          e.doctorName ?? '—',
          e.performerName ?? '—',
          e.refunded ? `${n(e.revenue)} (đã hoàn tiền)` : n(e.revenue),
          n(e.cost),
          n(e.margin),
          ...(multiBranch ? [e.branchName] : []),
        ]),
        totalRows: capped ? undefined : [['Cộng', '', '', '', '', '', n(report.totalRevenue), n(report.totalCost), n(report.totalMargin), ...(multiBranch ? [''] : [])]],
        emptyText: 'Không có lượt dịch vụ nào ghi tiêu hao trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.entries.length)} lượt mới nhất trong ${n(report.entryCount)} lượt; tổng đầu trang tính trên tất cả.` : undefined,
  };
}

/** Dịch vụ dùng của một mặt hàng: tối đa hai tên, phần còn lại gộp thành "và N dịch vụ khác". */
export function describeItemServices(names: readonly string[], serviceCount: number): string {
  if (names.length === 0) return '—';
  const rest = serviceCount - names.length;
  return rest > 0 ? `${names.join(', ')} và ${n(rest)} dịch vụ khác` : names.join(', ');
}

/** Số lượng kèm đơn vị cơ sở: "60 cái"; mặt hàng chưa khai đơn vị thì chỉ có số. */
export function formatItemQuantity(quantity: number, unitName: string): string {
  return unitName ? `${n(quantity)} ${unitName}` : n(quantity);
}

export function buildServiceConsumptionByItemPrintSpec(report: ServiceConsumptionByItemReport, ctx: ServiceConsumptionPrintContext): ReportPrintSpec {
  const capped = report.itemCount > report.rows.length;
  return {
    title: 'Chi phí vật tư theo mặt hàng',
    subtitleLines: [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : [])],
    infoLines: [`Tổng chi phí vốn: ${n(report.totalCost)} · Số mặt hàng đã dùng: ${n(report.itemCount)} (${n(report.supplyCount)} vật tư, ${n(report.medicineCount)} thuốc)`, NOTE],
    sections: [
      {
        columns: [
          { header: 'Mặt hàng' },
          { header: 'Loại' },
          { header: 'Dùng ở' },
          { header: 'Số lượng', align: 'right' },
          { header: 'Giá vốn TB / đơn vị', align: 'right' },
          { header: 'Chi phí vốn', align: 'right' },
          { header: 'Tỷ trọng', align: 'right' },
        ],
        rows: report.rows.map((r) => [
          r.name,
          r.itemType === 'MEDICINE' ? 'Thuốc' : 'Vật tư',
          describeItemServices(r.serviceNames, r.serviceCount),
          formatItemQuantity(r.quantity, r.unitName),
          r.averageUnitCost === null ? '—' : n(r.averageUnitCost),
          n(r.cost),
          percent(r.sharePercent),
        ]),
        totalRows: [[`Cộng ${n(report.itemCount)} mặt hàng`, '', '', '', '', n(report.totalCost), report.totalCost > 0 ? '100%' : '—']],
        emptyText: 'Không có vật tư hay thuốc nào được ghi tiêu hao trong kỳ đã chọn.',
      },
    ],
    note: capped ? `Chỉ in ${n(report.rows.length)} mặt hàng tốn nhiều nhất trong ${n(report.itemCount)} mặt hàng; dòng Cộng chỉ cộng các dòng đã in.` : undefined,
  };
}

export function buildServiceConsumptionByBranchPrintSpec(report: ServiceConsumptionByBranchReport, ctx: ServiceConsumptionPrintContext): ReportPrintSpec {
  return {
    title: 'Chi phí vật tư từng chi nhánh',
    subtitleLines: [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : [])],
    infoLines: [summaryLine(report), NOTE],
    sections: [
      {
        columns: [
          { header: 'Chi nhánh' },
          { header: 'Số lượt', align: 'right' },
          { header: 'Doanh thu', align: 'right' },
          { header: 'Chi phí vốn', align: 'right' },
          { header: 'Trung bình / lượt', align: 'right' },
          { header: 'Lãi gộp', align: 'right' },
          { header: 'Biên', align: 'right' },
        ],
        rows: report.rows.map((r) => [r.branchName, n(r.visitCount), n(r.revenue), n(r.cost), r.averageCost === null ? '—' : n(r.averageCost), n(r.margin), percent(r.marginPercent)]),
        totalRows: [[`Cộng ${n(report.rows.length)} chi nhánh`, n(report.visitCount), n(report.totalRevenue), n(report.totalCost), report.averageCost === null ? '—' : n(report.averageCost), n(report.totalMargin), percent(report.marginPercent)]],
        emptyText: 'Không có chi nhánh nào trong phạm vi đã chọn.',
      },
    ],
  };
}

export { formatDateTime as formatConsumptionDateTime };
