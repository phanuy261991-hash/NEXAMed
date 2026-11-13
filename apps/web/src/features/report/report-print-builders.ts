import type {
  AuditLogEntry,
  CashBookLedgerResponse,
  CashFlowReportResponse,
  GetStockLedgerReportResponse,
  GetStockTransferShrinkageResponse,
  StockBalanceItem,
  StockBalanceStatus,
  StockExpiryWarningItem,
  PurchaseOrderSummary,
  StockRequestSummary,
  StockTransferShrinkageCause,
  SupplierDebtLedgerEntry,
  SupplierDebtLedgerSummary,
  WalletListItem,
} from '@nexamed/shared';
import { formatDobDisplay } from '../../shared/format/date';
import { formatVndPlain } from '../../shared/format/currency';
import { formatDateTimeVn } from '../../shared/format/time';
import type { ReportPrintSpec } from '../../shared/print/report-print-spec';
import type { StockLedgerDisplayRow } from '../inventory/stock-ledger-rows';
import { ENTRY_TYPE_LABEL } from '../supplier-debt/ledger-labels';
import { formatDayVn, REQUEST_PRIORITY_LABEL, REQUEST_STATUS_META } from '../inventory/stock-request-meta';
import { ORDER_STATUS_META } from '../inventory/purchase-order-meta';

/**
 * Hàm THUẦN đổi dữ liệu đang xem của từng báo cáo ĐÃ CÓ thành bản in (docs/DECISIONS.md #287: mọi báo cáo phải in được). Không gọi API, không biết gì về giao diện —
 * trang báo cáo truyền dữ liệu đã tải + bộ lọc vào, `ReportTablePrintView` vẽ ra giấy. Số tiền không hậu tố "đ" (đơn vị đã rõ từ ngữ cảnh, như trên màn hình báo cáo).
 */

const n = (value: number): string => value.toLocaleString('vi-VN');
const money = (value: number): string => formatVndPlain(value);
const signed = (value: number): string => (value < 0 ? `−${money(Math.abs(value))}` : value > 0 ? `+${money(value)}` : '0');
const period = (from: string, to: string): string => `Từ ${formatDobDisplay(from)} đến ${formatDobDisplay(to)}`;

/** Báo cáo dòng tiền. `scopeLabel` (ví dụ "Quận 1, Quận 7") chỉ có khi báo cáo gộp từ hai chi nhánh. */
export function buildCashFlowPrintSpec(report: CashFlowReportResponse, ctx: { from: string; to: string; scopeLabel: string | null }): ReportPrintSpec {
  const multiBranch = report.byBranch.length > 1;
  const sections: ReportPrintSpec['sections'] = [];
  if (multiBranch) {
    sections.push({
      title: 'Theo chi nhánh',
      columns: [{ header: 'Chi nhánh' }, { header: 'Tổng thu', align: 'right' }, { header: 'Tổng chi', align: 'right' }, { header: 'Chênh lệch', align: 'right' }],
      rows: report.byBranch.map((b) => [b.branchName, money(b.totalIncome), money(b.totalExpense), signed(b.totalIncome - b.totalExpense)]),
      totalRows: [[`Cộng ${report.byBranch.length} chi nhánh`, money(report.totalIncome), money(report.totalExpense), signed(report.totalIncome - report.totalExpense)]],
    });
  }
  sections.push({
    title: 'Theo Loại thu chi',
    columns: [{ header: 'Loại thu chi' }, { header: 'Tổng thu', align: 'right' }, { header: 'Tổng chi', align: 'right' }],
    rows: report.byType.map((g) => [g.label, g.totalIncome > 0 ? money(g.totalIncome) : '—', g.totalExpense > 0 ? money(g.totalExpense) : '—']),
    emptyText: 'Không có khoản thu chi nào trong kỳ.',
  });
  sections.push({
    title: 'Theo Quỹ',
    columns: [
      { header: 'Quỹ' },
      ...(multiBranch ? [{ header: 'Chi nhánh' }] : []),
      { header: 'Tổng thu', align: 'right' as const },
      { header: 'Tổng chi', align: 'right' as const },
      { header: 'Tồn quỹ', align: 'right' as const },
    ],
    rows: report.byAccount.map((g) => [g.label, ...(multiBranch ? [g.branchName] : []), g.totalIncome > 0 ? money(g.totalIncome) : '—', g.totalExpense > 0 ? money(g.totalExpense) : '—', money(g.closingBalance)]),
    emptyText: 'Chưa có quỹ nào.',
  });
  return {
    title: 'Báo cáo dòng tiền',
    subtitleLines: [period(ctx.from, ctx.to), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : [])],
    infoLines: [`Tổng thu: ${money(report.totalIncome)} · Tổng chi: ${money(report.totalExpense)} · Chênh lệch: ${signed(report.totalIncome - report.totalExpense)}`],
    sections,
  };
}

export const LEDGER_ENTRY_TYPE_LABEL: Record<string, string> = {
  INVOICE_PAYMENT: 'Thu tiền khám',
  INVOICE_REFUND: 'Hoàn tiền khám',
  VOUCHER_INCOME: 'Phiếu thu',
  VOUCHER_EXPENSE: 'Phiếu chi',
  TRANSFER_IN: 'Chuyển quỹ đến',
  TRANSFER_OUT: 'Chuyển quỹ đi',
};

/** Sổ quỹ của MỘT quỹ. Dòng in theo thứ tự thời gian CŨ → MỚI để số dư luỹ kế đọc xuôi từ đầu kỳ (màn hình hiện mới nhất trước). */
export function buildCashBookLedgerPrintSpec(ledger: CashBookLedgerResponse, ctx: { from: string; to: string; accountLabel: string }): ReportPrintSpec {
  return {
    title: 'Sổ quỹ',
    subtitleLines: [period(ctx.from, ctx.to), `Quỹ: ${ctx.accountLabel}`, `Chi nhánh: ${ledger.branchName}`],
    infoLines: [`Số dư đầu kỳ: ${money(ledger.openingBalance)} · Số dư cuối kỳ: ${money(ledger.closingBalance)}`],
    sections: [
      {
        columns: [
          { header: 'Ngày', width: '84px' },
          { header: 'Loại chứng từ', width: '112px' },
          { header: 'Diễn giải' },
          { header: 'Số tiền', align: 'right', width: '104px' },
          { header: 'Số dư luỹ kế', align: 'right', width: '112px' },
        ],
        rows: ledger.entries.map((e) => [
          formatDateTimeVn(e.occurredAt).slice(0, 10),
          LEDGER_ENTRY_TYPE_LABEL[e.entryType] ?? e.entryType,
          `${e.description} · ${e.referenceNo}`,
          signed(e.amountSigned),
          money(e.runningBalance),
        ]),
        emptyText: 'Không có chứng từ nào trong khoảng ngày đã chọn.',
      },
    ],
  };
}

/** Báo cáo Nhập-Xuất-Tồn. `rows` là dòng ĐANG HIỂN THỊ (đã gộp theo mặt hàng nếu người xem chọn gộp). */
export function buildStockLedgerPrintSpec(
  report: Pick<GetStockLedgerReportResponse, 'totalOpeningQuantity' | 'totalIn' | 'totalOut' | 'totalClosingQuantity'>,
  rows: readonly StockLedgerDisplayRow[],
  ctx: { from: string; to: string; multiBranch: boolean; warehouseLabel: string | null; scopeLabel: string | null },
): ReportPrintSpec {
  const multi = ctx.multiBranch;
  return {
    title: 'Báo cáo Nhập-Xuất-Tồn',
    subtitleLines: [period(ctx.from, ctx.to), ...(ctx.warehouseLabel ? [`Kho: ${ctx.warehouseLabel}`] : []), ...(ctx.scopeLabel ? [`Phạm vi: ${ctx.scopeLabel}`] : [])],
    sections: [
      {
        columns: [
          { header: 'Mã', width: '70px' },
          { header: 'Tên mặt hàng' },
          { header: 'ĐVT', align: 'center', width: '52px' },
          ...(multi ? [{ header: 'Chi nhánh' }] : []),
          { header: 'Kho' },
          { header: 'Đầu kỳ', align: 'right', width: '64px' },
          { header: 'Nhập', align: 'right', width: '64px' },
          { header: 'Xuất', align: 'right', width: '64px' },
          { header: 'Cuối kỳ', align: 'right', width: '64px' },
        ],
        rows: rows.map((r) => [
          r.drugCode,
          r.drugName,
          r.unitCode ?? '—',
          ...(multi ? [r.branchLabel] : []),
          r.warehouseLabel,
          n(r.openingQuantity),
          r.totalIn > 0 ? `+${n(r.totalIn)}` : '—',
          r.totalOut > 0 ? `-${n(r.totalOut)}` : '—',
          n(r.closingQuantity),
        ]),
        totalRows: [['Tổng', '', '', ...(multi ? [''] : []), '', n(report.totalOpeningQuantity), `+${n(report.totalIn)}`, `-${n(report.totalOut)}`, n(report.totalClosingQuantity)]],
        emptyText: 'Không có biến động tồn kho nào trong kỳ.',
      },
    ],
  };
}

const SHRINKAGE_CAUSE_LABEL: Record<StockTransferShrinkageCause, string> = { WRITE_OFF: 'Ghi hao hụt', RETURN_SHORTAGE: 'Nhận lại thiếu' };

export function buildStockShrinkagePrintSpec(report: GetStockTransferShrinkageResponse, ctx: { from: string; to: string; warehouseLabel: string | null; causeLabel: string | null }): ReportPrintSpec {
  return {
    title: 'Hao hụt điều chuyển kho',
    subtitleLines: [period(ctx.from, ctx.to), ...(ctx.warehouseLabel ? [`Kho gửi: ${ctx.warehouseLabel}`] : []), ...(ctx.causeLabel ? [`Nguyên nhân: ${ctx.causeLabel}`] : [])],
    infoLines: [`Tổng số lượng hao hụt: ${n(report.totalQuantity)} · Tổng giá trị (giá vốn): ${money(report.totalValue)} · Số phiếu có hao hụt: ${n(report.transferCount)}`],
    sections: [
      {
        columns: [
          { header: 'Số phiếu', width: '84px' },
          { header: 'Ngày chuyển', width: '78px' },
          { header: 'Từ → Đến' },
          { header: 'Mặt hàng' },
          { header: 'SL', align: 'right', width: '44px' },
          { header: 'Giá vốn', align: 'right', width: '78px' },
          { header: 'Giá trị', align: 'right', width: '84px' },
          { header: 'Nguyên nhân', width: '88px' },
        ],
        rows: report.items.map((i) => [
          i.transferNo,
          formatDateTimeVn(i.occurredAt).slice(0, 10),
          `${i.fromWarehouseName} → ${i.toWarehouseName}`,
          `${i.drugName} (${i.drugCode})`,
          n(i.quantity),
          money(i.unitCost),
          money(i.lineValue),
          SHRINKAGE_CAUSE_LABEL[i.cause],
        ]),
        totalRows: [['Tổng', '', '', '', n(report.totalQuantity), '', money(report.totalValue), '']],
        emptyText: 'Không có hao hụt điều chuyển nào trong kỳ.',
      },
    ],
  };
}

const BALANCE_STATUS_LABEL: Record<StockBalanceStatus, string> = { NORMAL: 'Bình thường', LOW: 'Sắp hết', HIGH: 'Vượt định mức', OUT: 'Hết hàng' };

function expiryText(item: StockExpiryWarningItem): string {
  return item.status === 'EXPIRED' ? `${formatDobDisplay(item.expiryDate)} · đã quá ${Math.abs(item.daysUntilExpiry)} ngày` : `${formatDobDisplay(item.expiryDate)} · còn ${item.daysUntilExpiry} ngày`;
}

/** Tồn kho theo mặt hàng + Cảnh báo hạn dùng trong CÙNG một bản in (hai bảng). */
export function buildStockBalancePrintSpec(
  balances: readonly StockBalanceItem[],
  expiries: readonly StockExpiryWarningItem[],
  ctx: { warehouseLabel: string | null; belowMinOnly: boolean; keyword: string | null; unitName: (code: string) => string },
): ReportPrintSpec {
  return {
    title: 'Tồn kho và hạn dùng',
    subtitleLines: [
      ...(ctx.warehouseLabel ? [`Kho: ${ctx.warehouseLabel}`] : ['Tất cả kho']),
      ...(ctx.belowMinOnly ? ['Chỉ mặt hàng dưới định mức tồn'] : []),
      ...(ctx.keyword ? [`Tìm: ${ctx.keyword}`] : []),
    ],
    sections: [
      {
        title: 'Tồn kho theo mặt hàng',
        columns: [
          { header: 'Mã', width: '70px' },
          { header: 'Tên thuốc / vật tư' },
          { header: 'Loại', width: '64px' },
          { header: 'Kho' },
          { header: 'Đơn vị', width: '56px' },
          { header: 'Tồn', align: 'right', width: '56px' },
          { header: 'Định mức', align: 'center', width: '72px' },
          { header: 'Trạng thái', width: '84px' },
        ],
        rows: balances.map((b) => [
          b.drugCode,
          b.drugName,
          b.itemType === 'MEDICINE' ? 'Thuốc' : 'Vật tư',
          b.warehouseName,
          b.unitCode ? ctx.unitName(b.unitCode) : '—',
          n(b.quantityOnHand),
          b.minStockAlert !== null || b.maxStockAlert !== null ? `${b.minStockAlert ?? 0} – ${b.maxStockAlert ?? '∞'}` : '—',
          BALANCE_STATUS_LABEL[b.status],
        ]),
        emptyText: 'Chưa có tồn kho.',
      },
      {
        title: 'Cảnh báo hạn dùng',
        columns: [
          { header: 'Số lô', width: '84px' },
          { header: 'Thuốc / vật tư' },
          { header: 'Kho' },
          { header: 'NSX', width: '76px' },
          { header: 'Hạn dùng', width: '150px' },
          { header: 'Tồn', align: 'right', width: '56px' },
          { header: 'Trạng thái', width: '84px' },
        ],
        rows: expiries.map((e) => [e.batchNo, e.drugName, e.warehouseName, e.manufactureDate ? formatDobDisplay(e.manufactureDate) : '', expiryText(e), n(e.quantityOnHand), e.status === 'EXPIRED' ? 'Đã hết hạn' : 'Sắp hết hạn']),
        emptyText: 'Không có lô nào sắp hoặc đã hết hạn.',
      },
    ],
  };
}

export interface SupplierDebtPrintRow {
  code: string;
  name: string;
  totalPurchase: number | null;
  totalPaid: number | null;
  /** Dương = còn nợ NCC; âm = NCC nợ lại; `null` = chưa có sổ công nợ. */
  balance: number | null;
  pendingApprovalAmount: number;
}

export function buildSupplierDebtPrintSpec(rows: readonly SupplierDebtPrintRow[], ctx: { search: string | null; showAll: boolean }): ReportPrintSpec {
  const dash = (v: number | null) => (v === null ? '—' : money(v));
  let owed = 0;
  let owedBack = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.balance !== null && r.balance > 0) owed += r.balance;
    if (r.balance !== null && r.balance < 0) owedBack += -r.balance;
    pending += r.pendingApprovalAmount;
  }
  return {
    title: 'Công nợ nhà cung cấp',
    subtitleLines: [ctx.showAll ? 'Gồm cả nhà cung cấp đã tất toán hoặc chưa phát sinh' : 'Chỉ nhà cung cấp còn nợ, nợ lại hoặc có phiếu chi chờ duyệt', ...(ctx.search ? [`Tìm: ${ctx.search}`] : [])],
    infoLines: [`Tổng còn nợ: ${money(owed)} · NCC đang nợ lại: ${money(owedBack)}${pending > 0 ? ` · Phiếu chi chờ duyệt: ${money(pending)}` : ''}`],
    sections: [
      {
        columns: [
          { header: 'Mã', width: '70px' },
          { header: 'Nhà cung cấp' },
          { header: 'Tổng tiền hàng', align: 'right', width: '104px' },
          { header: 'Đã thanh toán', align: 'right', width: '104px' },
          { header: 'Còn nợ', align: 'right', width: '112px' },
          { header: 'Chờ duyệt', align: 'right', width: '92px' },
        ],
        rows: rows.map((r) => [
          r.code,
          r.name,
          dash(r.totalPurchase),
          dash(r.totalPaid),
          r.balance === null ? '—' : r.balance === 0 ? 'Đã tất toán' : r.balance < 0 ? `${money(-r.balance)} (NCC nợ lại)` : money(r.balance),
          r.pendingApprovalAmount > 0 ? money(r.pendingApprovalAmount) : '—',
        ]),
        emptyText: 'Không có nhà cung cấp nào có công nợ.',
      },
    ],
  };
}

/**
 * Sổ công nợ của MỘT nhà cung cấp/đối tác theo khoảng ngày (docs/DECISIONS.md #292). `from`/`to` rỗng = không giới hạn. Tăng nợ và giảm nợ ở hai cột riêng; dòng đã bị đảo ghi chú "đã bị đảo".
 * Số dư dương = còn nợ nhà cung cấp, âm = nhà cung cấp nợ lại.
 */
export function buildSupplierDebtLedgerPrintSpec(
  entries: readonly SupplierDebtLedgerEntry[],
  summary: SupplierDebtLedgerSummary,
  ctx: { supplierCode: string; supplierName: string; from: string; to: string },
): ReportPrintSpec {
  const dateOf = (iso: string): string => formatDateTimeVn(iso).slice(0, 10);
  const balance = (v: number): string => (v < 0 ? `${money(-v)} (NCC nợ lại)` : money(v));
  const periodLine = ctx.from || ctx.to ? `Từ ${ctx.from ? formatDobDisplay(ctx.from) : 'đầu'} đến ${ctx.to ? formatDobDisplay(ctx.to) : 'nay'}` : 'Toàn bộ lịch sử';
  return {
    title: 'Sổ công nợ nhà cung cấp',
    subtitleLines: [`${ctx.supplierCode} · ${ctx.supplierName}`, periodLine],
    infoLines: [`Số dư đầu kỳ: ${balance(summary.openingBalance)} · Tăng nợ: ${money(summary.totalIncrease)} · Giảm nợ: ${money(summary.totalDecrease)} · Số dư cuối kỳ: ${balance(summary.closingBalance)}`],
    sections: [
      {
        columns: [
          { header: 'Ngày chứng từ', width: '84px' },
          { header: 'Loại', width: '96px' },
          { header: 'Chứng từ', width: '112px' },
          { header: 'Ghi chú' },
          { header: 'Tăng nợ', align: 'right', width: '92px' },
          { header: 'Giảm nợ', align: 'right', width: '92px' },
          { header: 'Số dư sau', align: 'right', width: '100px' },
        ],
        rows: entries.map((e) => [
          dateOf(e.occurredAt),
          ENTRY_TYPE_LABEL[e.entryType],
          e.stockReceiptNo ?? e.stockIssueNo ?? e.cashVoucherNo ?? '—',
          [e.reversed ? 'đã bị đảo' : '', e.note ?? ''].filter(Boolean).join(' · ') || '—',
          e.amountChange > 0 ? money(e.amountChange) : '—',
          e.amountChange < 0 ? money(-e.amountChange) : '—',
          money(e.balanceAfter),
        ]),
        totalRows: entries.length > 0 ? [['Cộng trong kỳ', '', '', '', money(summary.totalIncrease), money(summary.totalDecrease), balance(summary.closingBalance)]] : undefined,
        emptyText: 'Không có bút toán nào trong kỳ.',
      },
    ],
  };
}

const WALLET_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Đang hoạt động', CLOSED: 'Đã khoá' };

export function buildWalletsPrintSpec(
  items: readonly WalletListItem[],
  ctx: { statusLabel: string; search: string | null; totalHeldBalance: number; activeWalletCount: number; toppedUpToday: number; deductedToday: number; capped: boolean },
): ReportPrintSpec {
  return {
    title: 'Ví tạm ứng',
    subtitleLines: [`Trạng thái: ${ctx.statusLabel}`, ...(ctx.search ? [`Tìm: ${ctx.search}`] : [])],
    infoLines: [`Đang giữ hộ khách: ${money(ctx.totalHeldBalance)} · Ví hoạt động: ${n(ctx.activeWalletCount)} · Nạp hôm nay: ${money(ctx.toppedUpToday)} · Cấn trừ hôm nay: ${money(ctx.deductedToday)}`],
    sections: [
      {
        columns: [
          { header: 'Mã BN', width: '84px' },
          { header: 'Họ tên' },
          { header: 'Số điện thoại', width: '92px' },
          { header: 'Số dư', align: 'right', width: '92px' },
          { header: 'Đã nạp', align: 'right', width: '92px' },
          { header: 'Đã dùng', align: 'right', width: '92px' },
          { header: 'Giao dịch gần nhất', width: '112px' },
          { header: 'Trạng thái', width: '92px' },
        ],
        rows: items.map((w) => [
          w.patientCode,
          w.fullName,
          w.phone ?? '—',
          money(w.balance),
          money(w.totalToppedUp),
          money(w.totalUsed),
          w.lastTransactionAt ? formatDateTimeVn(w.lastTransactionAt) : '—',
          WALLET_STATUS_LABEL[w.status] ?? w.status,
        ]),
        emptyText: 'Không có ví nào.',
      },
    ],
    note: ctx.capped ? 'Chỉ in các dòng đầu tiên (giới hạn mỗi bản in); dùng "Xuất Excel" để lấy đủ.' : undefined,
  };
}

export function buildAuditLogPrintSpec(entries: readonly AuditLogEntry[], ctx: { filterLines: string[]; capped: boolean }): ReportPrintSpec {
  return {
    title: 'Nhật ký kiểm toán',
    subtitleLines: ctx.filterLines,
    sections: [
      {
        columns: [
          { header: 'Thời gian', width: '110px' },
          { header: 'Người thực hiện', width: '130px' },
          { header: 'Hành động' },
          { header: 'Đối tượng' },
        ],
        rows: entries.map((e) => [formatDateTimeVn(e.occurredAt), e.actorName ?? 'Hệ thống', e.isBreakGlass ? `${e.actionLabel} (truy cập khẩn cấp)` : e.actionLabel, e.entityLabel]),
        emptyText: 'Không có bản ghi nào khớp bộ lọc.',
      },
    ],
    note: ctx.capped ? 'Chỉ in các dòng đầu tiên (giới hạn mỗi bản in); dùng "Xuất Excel" để lấy đủ.' : undefined,
  };
}

/** In danh sách Phiếu yêu cầu cấp hàng (#298; quy tắc #287: mọi bảng kê in được). `view` = tab đang xem; `multiBranch` thêm cột chi nhánh khi công ty có từ 2 chi nhánh. */
export function buildStockRequestListPrintSpec(items: StockRequestSummary[], ctx: { view: 'mine' | 'incoming'; filterLabels: string[]; multiBranch: boolean }): ReportPrintSpec {
  const place = (branch: string, warehouse: string) => (ctx.multiBranch ? `${branch} / ${warehouse}` : warehouse);
  return {
    title: ctx.view === 'mine' ? 'Danh sách yêu cầu cấp hàng của tôi' : 'Danh sách yêu cầu cấp hàng cần duyệt',
    subtitleLines: ctx.filterLabels,
    sections: [
      {
        columns: [
          { header: 'Số phiếu', width: '96px' },
          { header: 'Ngày lập', width: '72px' },
          { header: 'Kho xin' },
          { header: 'Kho cấp' },
          { header: 'Khẩn', width: '50px' },
          { header: 'Ngày cần', width: '72px' },
          { header: 'Dòng', align: 'right', width: '40px' },
          { header: 'Trạng thái', width: '96px' },
        ],
        rows: items.map((r) => [
          r.requestNo,
          formatDateTimeVn(r.createdAt).slice(0, 10),
          place(r.requestingBranchName, r.requestingWarehouseName),
          place(r.supplyingBranchName, r.supplyingWarehouseName),
          REQUEST_PRIORITY_LABEL[r.priority],
          r.neededBy ? formatDayVn(r.neededBy) : '',
          n(r.lineCount),
          REQUEST_STATUS_META[r.status].label,
        ]),
        emptyText: 'Không có phiếu yêu cầu cấp hàng nào.',
      },
    ],
  };
}

/** In danh sách Đơn đặt hàng NCC (#298 giai đoạn 2; quy tắc #287: mọi bảng kê in được). `view` = tab đang xem; `multiBranch` thêm tên chi nhánh khi công ty có từ 2 chi nhánh. */
export function buildPurchaseOrderListPrintSpec(items: PurchaseOrderSummary[], ctx: { view: 'mine' | 'approval'; filterLabels: string[]; multiBranch: boolean }): ReportPrintSpec {
  return {
    title: ctx.view === 'mine' ? 'Danh sách đơn đặt hàng NCC của chi nhánh' : 'Danh sách đơn đặt hàng NCC cần duyệt',
    subtitleLines: ctx.filterLabels,
    sections: [
      {
        columns: [
          { header: 'Số đơn', width: '96px' },
          { header: 'Ngày lập', width: '72px' },
          { header: 'Nhà cung cấp' },
          { header: 'Kho nhận' },
          { header: 'Giao dự kiến', width: '80px' },
          { header: 'Dòng', align: 'right', width: '40px' },
          { header: 'Tổng dự kiến', align: 'right', width: '96px' },
          { header: 'Trạng thái', width: '110px' },
        ],
        rows: items.map((r) => [
          r.orderNo,
          formatDateTimeVn(r.createdAt).slice(0, 10),
          r.supplierName,
          ctx.multiBranch ? `${r.branchName} / ${r.warehouseName}` : r.warehouseName,
          r.expectedDate ? formatDayVn(r.expectedDate) : '',
          n(r.lineCount),
          r.totalAmount > 0 ? n(r.totalAmount) : '',
          ORDER_STATUS_META[r.status].label,
        ]),
        emptyText: 'Không có đơn đặt hàng nào.',
      },
    ],
  };
}
