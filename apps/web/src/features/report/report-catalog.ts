import { stripDiacritics } from '../../shared/format/strip-diacritics';

/**
 * Danh mục báo cáo của "Trung tâm báo cáo" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026). CHỈ liệt kê báo cáo ĐÃ LÀM thật — báo cáo chưa làm không hiện (không dựng giả);
 * thêm báo cáo mới = thêm một dòng ở đây. `permission` giống hệt quyền của route/menu tương ứng nên mục nào người xem không mở được thì không hiện.
 * `excel`/`print` ghi đúng thực tế để thấy báo cáo nào còn thiếu (quy tắc: MỌI báo cáo phải có cả hai — test `report-catalog.spec.ts` liệt kê các báo cáo chưa đủ).
 */
export type ReportScopeText = 'Chi nhánh · Toàn công ty' | 'Một chi nhánh' | 'Toàn công ty';

export interface ReportCatalogItem {
  id: string;
  group: string;
  name: string;
  description: string;
  scope: ReportScopeText;
  excel: boolean;
  print: boolean;
  to: string;
  permission: readonly [string, string];
}

export const REPORT_CATALOG: readonly ReportCatalogItem[] = [
  {
    id: 'daily',
    group: 'Doanh thu và thu chi',
    name: 'Báo cáo ngày',
    description: 'Lượt khám, tiền thu theo phương thức, phiếu chưa thu, các ca',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/reports/daily',
    permission: ['daily_report', 'read'],
  },
  {
    id: 'visit-book',
    group: 'Khám bệnh và vận hành',
    name: 'Sổ khám bệnh',
    description: 'Lượt khám đã hoàn tất theo ngày, chẩn đoán, bác sĩ, dịch vụ, thành tiền',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/reports/operations',
    permission: ['operations_report', 'read'],
  },
  {
    id: 'peak-hours',
    group: 'Khám bệnh và vận hành',
    name: 'Giờ cao điểm',
    description: 'Lượt khám theo thứ và giờ, thời gian chờ theo khung giờ',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/reports/operations?tab=peak-hours',
    permission: ['operations_report', 'read'],
  },
  {
    id: 'waiting',
    group: 'Khám bệnh và vận hành',
    name: 'Thời gian chờ',
    description: 'Từ tiếp nhận đến vào khám, theo bác sĩ và theo ngày',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/reports/operations?tab=waiting',
    permission: ['operations_report', 'read'],
  },
  {
    id: 'cancellations',
    group: 'Khám bệnh và vận hành',
    name: 'Huỷ và không đến',
    description: 'Lượt khám và lịch hẹn bị huỷ, không đến, lý do',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/reports/operations?tab=cancellations',
    permission: ['operations_report', 'read'],
  },
  {
    id: 'follow-ups',
    group: 'Khám bệnh và vận hành',
    name: 'Tái khám',
    description: 'Hẹn đã đến, quá hạn chưa đến, các lần nhắc',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/reports/operations?tab=follow-ups',
    permission: ['operations_report', 'read'],
  },
  {
    id: 'booking-sources',
    group: 'Khám bệnh và vận hành',
    name: 'Nguồn đặt lịch',
    description: 'Lịch hẹn theo điện thoại, online, walk-in và tỉ lệ đến',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/reports/operations?tab=booking-sources',
    permission: ['operations_report', 'read'],
  },
  {
    id: 'cash-flow',
    group: 'Doanh thu và thu chi',
    name: 'Báo cáo dòng tiền',
    description: 'Thu, chi, tồn quỹ theo loại và theo quỹ',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/cash-book/report',
    permission: ['cash_voucher', 'report'],
  },
  {
    id: 'cash-ledger',
    group: 'Doanh thu và thu chi',
    name: 'Sổ quỹ',
    description: 'Chứng từ và số dư luỹ kế từng quỹ',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/cash-book/ledger',
    permission: ['cash_voucher', 'read'],
  },
  {
    id: 'wallets',
    group: 'Doanh thu và thu chi',
    name: 'Ví tạm ứng',
    description: 'Số dư ví của bệnh nhân toàn phòng khám',
    scope: 'Toàn công ty',
    excel: true,
    print: true,
    to: '/cash-book/wallets',
    permission: ['patient_wallet', 'settle'],
  },
  {
    id: 'stock-ledger',
    group: 'Thuốc và vật tư',
    name: 'Nhập-Xuất-Tồn',
    description: 'Đầu kỳ, nhập, xuất, cuối kỳ theo mặt hàng',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/inventory/reports/stock-ledger',
    permission: ['stock_receipt', 'report'],
  },
  {
    id: 'transfer-shrinkage',
    group: 'Thuốc và vật tư',
    name: 'Hao hụt điều chuyển',
    description: 'Chênh lệch giữa các chi nhánh khi điều chuyển kho',
    scope: 'Chi nhánh · Toàn công ty',
    excel: true,
    print: true,
    to: '/inventory/reports/stock-ledger?tab=shrinkage',
    permission: ['stock_receipt', 'report'],
  },
  {
    id: 'stock-balance',
    group: 'Thuốc và vật tư',
    name: 'Tồn kho và hạn dùng',
    description: 'Tồn theo lô, cảnh báo cận hạn',
    scope: 'Một chi nhánh',
    excel: true,
    print: true,
    to: '/inventory/balances',
    permission: ['stock_receipt', 'read'],
  },
  {
    id: 'supplier-debt',
    group: 'Thuốc và vật tư',
    name: 'Công nợ nhà cung cấp',
    description: 'Số nợ, thanh toán, đối chiếu theo kỳ',
    scope: 'Toàn công ty',
    excel: true,
    print: true,
    to: '/suppliers/debts',
    permission: ['supplier_debt', 'read'],
  },
  {
    id: 'audit-log',
    group: 'Chất lượng và tuân thủ',
    name: 'Nhật ký kiểm toán',
    description: 'Ai làm gì, lúc nào',
    scope: 'Toàn công ty',
    excel: true,
    print: true,
    to: '/admin/activity-log',
    permission: ['audit_log', 'read'],
  },
];

/** Chữ hiện ở cột "Xuất": "Excel · In", "Excel", "In" hoặc "—" (báo cáo chưa có cả hai). */
export function exportLabel(item: Pick<ReportCatalogItem, 'excel' | 'print'>): string {
  const parts = [item.excel ? 'Excel' : null, item.print ? 'In' : null].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** Báo cáo còn thiếu Excel hoặc In — danh sách việc cần bổ sung theo quy tắc "mọi báo cáo phải có cả hai". */
export function reportsMissingExports(catalog: readonly ReportCatalogItem[] = REPORT_CATALOG): ReportCatalogItem[] {
  return catalog.filter((r) => !r.excel || !r.print);
}

/** Chữ thường, bỏ dấu, mọi ký tự không phải chữ/số (gạch nối, phẩy...) thành một dấu cách — để gõ "nhap xuat" vẫn ra "Nhập-Xuất-Tồn". */
function normalizeForSearch(text: string): string {
  return stripDiacritics(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Lọc theo từ khoá (không phân biệt hoa thường, bỏ dấu, bỏ gạch nối) trên tên, mô tả và tên nhóm; từ khoá rỗng giữ nguyên. */
export function filterReportCatalog<T extends Pick<ReportCatalogItem, 'name' | 'description' | 'group'>>(items: readonly T[], keyword: string): T[] {
  const q = normalizeForSearch(keyword);
  if (q === '') return [...items];
  return items.filter((r) => normalizeForSearch(`${r.name} ${r.description} ${r.group}`).includes(q));
}

/** Gom theo nhóm, giữ thứ tự xuất hiện đầu tiên của nhóm; nhóm rỗng không có. */
export function groupReportCatalog<T extends Pick<ReportCatalogItem, 'group'>>(items: readonly T[]): Array<{ group: string; items: T[] }> {
  const groups: Array<{ group: string; items: T[] }> = [];
  for (const item of items) {
    const found = groups.find((g) => g.group === item.group);
    if (found) found.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  return groups;
}
