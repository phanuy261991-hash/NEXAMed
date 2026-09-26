import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardText, Eye, HandCoins, Lock, Receipt, Scales, ShoppingCart, Truck, ArrowUUpLeft, Warning } from '@phosphor-icons/react';
import type { SupplierDebtAdjustment, SupplierDebtLedgerEntry, SupplierDebtPayment, SupplierDebtReceiptStatus, SupplierDebtReconciliation } from '@nexamed/shared';
import { formatVnd } from '../../shared/format/currency';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { StatCardRow } from '../../shared/ui/StatCard';
import { TabBar } from '../../shared/ui/TabBar';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { ApiError } from '../../shared/api/client';
import { useHasPermission } from '../auth/usePermission';
import { CashVoucherDetailDialog } from '../cash-book/CashVoucherDetailDialog';
import { useSuppliersQuery } from '../drug/supplier.queries';
import { StockIssueDetailDialog } from '../inventory/StockIssueDetailDialog';
import { useStockIssuesQuery, useStockReceiptsQuery } from '../inventory/inventory.queries';
import { useCashAccountsQuery } from '../cash-book/cash-account.queries';
import { useClinicSettingsQuery } from '../clinic/clinic.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import {
  useFinalizeSupplierDebtReconciliationMutation,
  useRecordSupplierDebtOpeningBalanceMutation,
  useRecordSupplierDebtPaymentMutation,
  useRecordSupplierDebtRefundMutation,
  useSupplierDebtAdjustmentsQuery,
  useSupplierDebtLedgerQuery,
  useSupplierDebtPaymentsQuery,
  useSupplierDebtReceiptsQuery,
  useSupplierDebtReconciliationsQuery,
  useSupplierDebtSummaryQuery,
} from './supplier-debt.queries';
import { SupplierDebtAdjustmentDialog } from './SupplierDebtAdjustmentDialog';
import { SupplierDebtAdjustmentDetailDialog } from './SupplierDebtAdjustmentDetailDialog';
import { SupplierDebtReconciliationDialog } from './SupplierDebtReconciliationDialog';

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')} · ${formatDateShort(iso)}`;
}

const RECEIPT_STATUS_LABEL: Record<SupplierDebtReceiptStatus['status'], { label: string; tone: StatusBadgeTone }> = {
  UNPAID: { label: 'Chưa trả', tone: 'danger' },
  PARTIALLY_PAID: { label: 'Trả một phần', tone: 'warning' },
  FULLY_PAID: { label: 'Đã trả đủ', tone: 'success' },
};

const ENTRY_TYPE_LABEL: Record<SupplierDebtLedgerEntry['entryType'], string> = {
  OPENING_BALANCE: 'Nợ đầu kỳ',
  PURCHASE: 'Phát sinh nợ',
  PAYMENT: 'Thanh toán',
  RETURN: 'Trả hàng',
  REFUND_RECEIVED: 'NCC hoàn tiền',
  ADJUSTMENT_INCREASE: 'Điều chỉnh tăng',
  ADJUSTMENT_DECREASE: 'Điều chỉnh giảm',
  REVERSAL: 'Bút toán đảo',
};

type TabId = 'receipts' | 'returns' | 'ledger' | 'payments' | 'adjustments' | 'reconciliations';

/** Trang chi tiết NCC — "Công nợ nhà cung cấp" Phần A + Phần B + Phần C + Phần D (docs/DECISIONS.md
 * #180/#182/#187). 5 tab "Phiếu nhập"/"Phiếu trả hàng" (Phần C)/"Sổ công nợ" (Phần A)/"Thanh toán"
 * (Phần B)/"Nhật ký điều chỉnh" (Phần D). Không có `GET /suppliers/:id` riêng — tìm trong danh sách
 * đã tải sẵn (không phân trang, quy mô nhỏ, đúng khuôn `SupplierPane`). */
export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supplierId = id!;
  const [tab, setTab] = useState<TabId>('receipts');
  const [openingBalanceOpen, setOpeningBalanceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const canPay = useHasPermission('supplier_debt', 'pay');
  const canAdjust = useHasPermission('supplier_debt', 'adjust');

  const suppliersQuery = useSuppliersQuery(true);
  const summaryQuery = useSupplierDebtSummaryQuery(supplierId);
  const supplier = suppliersQuery.data?.items.find((s) => s.id === supplierId);

  useBreadcrumb([{ label: 'Quản lý nhà cung cấp' }, { label: 'Nhà cung cấp', to: '/suppliers' }, { label: supplier?.name ?? 'Đang tải...' }]);

  const isLoading = suppliersQuery.isLoading || summaryQuery.isLoading;
  const isError = suppliersQuery.isError || summaryQuery.isError;

  if (isError) {
    return <ErrorBanner message="Không tải được thông tin nhà cung cấp." onRetry={() => { void suppliersQuery.refetch(); void summaryQuery.refetch(); }} />;
  }
  if (isLoading || !supplier || !summaryQuery.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const summary = summaryQuery.data;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Link
        to="/suppliers"
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-3.5 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
      >
        <ArrowLeft size={14} weight="bold" aria-hidden="true" />
        Nhà cung cấp
      </Link>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600">
              <Truck size={20} weight="bold" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold text-slate-900">{supplier.name}</h1>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{supplier.code}</span>
                <StatusBadge tone={supplier.isActive ? 'success' : 'neutral'}>{supplier.isActive ? 'Đang dùng' : 'Ngưng'}</StatusBadge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-medium text-slate-600">
                {supplier.phone && <span>{supplier.phone}</span>}
                {supplier.taxCode && <span>MST: {supplier.taxCode}</span>}
                {supplier.contactName && <span>{supplier.contactName}</span>}
                {supplier.address && <span className="truncate">{supplier.address}</span>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {summary.canRecordOpeningBalance && (
              <Button type="button" variant="secondary" onClick={() => setOpeningBalanceOpen(true)}>
                <ClipboardText size={16} weight="bold" aria-hidden="true" />
                Khai nợ đầu kỳ
              </Button>
            )}
            {canAdjust && (
              <Button type="button" variant="secondary" onClick={() => setAdjustmentOpen(true)}>
                <Warning size={16} weight="bold" aria-hidden="true" />
                Lập phiếu điều chỉnh công nợ
              </Button>
            )}
            {canAdjust && (
              <Button type="button" variant="secondary" onClick={() => setReconciliationOpen(true)}>
                <Scales size={16} weight="bold" aria-hidden="true" />
                Lập biên bản đối chiếu
              </Button>
            )}
            {canPay && summary.balance > 0 && (
              <Button type="button" disabled={!summary.balanceIntegrityOk} onClick={() => setPaymentOpen(true)}>
                <HandCoins size={16} weight="bold" aria-hidden="true" />
                Thanh toán công nợ
              </Button>
            )}
            {canPay && summary.balance < 0 && (
              <Button type="button" disabled={!summary.balanceIntegrityOk} onClick={() => setRefundOpen(true)}>
                <ArrowUUpLeft size={16} weight="bold" aria-hidden="true" />
                Thu tiền NCC hoàn lại
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-stretch gap-3">
        <StatCardRow
          items={[
            { icon: ShoppingCart, tone: 'slate', label: 'Tổng tiền hàng đã mua', value: formatVnd(summary.totalPurchase) },
            { icon: HandCoins, tone: 'emerald', label: 'Đã thanh toán', value: formatVnd(summary.totalPaid) },
            {
              icon: Scales,
              tone: summary.balance < 0 ? 'blue' : 'rose',
              label: summary.balance < 0 ? 'NCC nợ lại' : 'Còn nợ',
              value: formatVnd(Math.abs(summary.balance)),
              emphasis: true,
            },
          ]}
        />
      </div>
      {!summary.balanceIntegrityOk && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">
          Số dư công nợ không khớp sổ — liên hệ quản trị. Đã tạm chặn Thanh toán/Thu tiền hoàn lại tới khi xử lý.
        </div>
      )}
      {summary.pendingApprovalAmount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
          Có {formatVnd(summary.pendingApprovalAmount)} phiếu chi đang chờ duyệt — công nợ chưa giảm cho tới khi được duyệt.
        </div>
      )}
      {summary.pendingAdjustmentCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
          Có {summary.pendingAdjustmentCount} phiếu điều chỉnh/đề nghị huỷ đang chờ duyệt — xem tab "Nhật ký điều chỉnh".
        </div>
      )}
      {summary.lockedAsOfDate && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700">
          <Lock size={16} weight="bold" aria-hidden="true" className="shrink-0 text-slate-500" />
          Đã chốt công nợ tới ngày {formatDateShort(summary.lockedAsOfDate)} — chứng từ trước ngày này chỉ Huỷ/Điều chỉnh được bởi người có quyền mở khoá kỳ công
          nợ.
        </div>
      )}

      <div className="min-h-0 flex-1 rounded-lg border border-slate-200 bg-white">
        <TabBar
          tabs={[
            { id: 'receipts', label: 'Phiếu nhập' },
            { id: 'returns', label: 'Phiếu trả hàng' },
            { id: 'ledger', label: 'Sổ công nợ' },
            { id: 'payments', label: 'Thanh toán' },
            { id: 'adjustments', label: 'Nhật ký điều chỉnh' },
            { id: 'reconciliations', label: 'Đối chiếu & Chốt kỳ' },
          ]}
          active={tab}
          onChange={setTab}
          className="border-b border-slate-200 px-3 py-2"
        />
        <div className="p-3">
          {tab === 'receipts' && <ReceiptsTab supplierId={supplierId} />}
          {tab === 'returns' && <ReturnsTab supplierId={supplierId} />}
          {tab === 'ledger' && <LedgerTab supplierId={supplierId} />}
          {tab === 'payments' && <PaymentsTab supplierId={supplierId} />}
          {tab === 'adjustments' && <AdjustmentsTab supplierId={supplierId} />}
          {tab === 'reconciliations' && <ReconciliationsTab supplierId={supplierId} />}
        </div>
      </div>

      {openingBalanceOpen && <OpeningBalanceDialog supplierId={supplierId} supplierName={supplier.name} onClose={() => setOpeningBalanceOpen(false)} />}
      {paymentOpen && <PaymentDialog supplierId={supplierId} supplierName={supplier.name} balance={summary.balance} onClose={() => setPaymentOpen(false)} />}
      {refundOpen && <RefundDialog supplierId={supplierId} supplierName={supplier.name} balance={summary.balance} onClose={() => setRefundOpen(false)} />}
      {adjustmentOpen && <SupplierDebtAdjustmentDialog supplierId={supplierId} supplierName={supplier.name} onClose={() => setAdjustmentOpen(false)} />}
      {reconciliationOpen && <SupplierDebtReconciliationDialog supplierId={supplierId} supplierName={supplier.name} onClose={() => setReconciliationOpen(false)} />}
    </div>
  );
}

function ReceiptsTab({ supplierId }: { supplierId: string }) {
  const debtQuery = useSupplierDebtReceiptsQuery(supplierId);
  const receiptsQuery = useStockReceiptsQuery({ supplierId, limit: 100 });

  const rows = useMemo(() => {
    if (!debtQuery.data) return [];
    const receiptById = new Map((receiptsQuery.data?.items ?? []).map((r) => [r.id, r]));
    return debtQuery.data.items.map((item) => ({ item, receipt: item.stockReceiptId ? receiptById.get(item.stockReceiptId) : undefined }));
  }, [debtQuery.data, receiptsQuery.data]);

  if (debtQuery.isError || receiptsQuery.isError) {
    return <ErrorBanner message="Không tải được danh sách phiếu nhập." onRetry={() => { void debtQuery.refetch(); void receiptsQuery.refetch(); }} />;
  }
  if (debtQuery.isLoading || receiptsQuery.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (rows.length === 0) {
    return <EmptyState icon={Receipt} title="Chưa có phiếu nhập nào" description="Công nợ NCC phát sinh khi Duyệt phiếu nhập kho loại &quot;Nhập nhà cung cấp&quot;." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
            <th className="px-3 py-2.5 text-center">Mã phiếu</th>
            <th className="px-3 py-2.5 text-center">Ngày nhập</th>
            <th className="px-3 py-2.5 text-center">Tiền hàng (sau CK)</th>
            <th className="px-3 py-2.5 text-center">Đã trả</th>
            <th className="px-3 py-2.5 text-center">Còn nợ</th>
            <th className="px-3 py-2.5 text-center">Tình trạng</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, receipt }) => {
            const statusInfo = RECEIPT_STATUS_LABEL[item.status];
            const key = item.stockReceiptId ?? 'opening-balance';
            return (
              <tr key={key} className={`border-b border-slate-200 last:border-0 ${receipt?.voided ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 text-center font-semibold text-slate-800">
                  {item.isOpeningBalance ? 'Nợ đầu kỳ' : (receipt?.receiptNo ?? '—')}
                  {receipt?.voided && <span className="ml-1.5 text-[11px] font-semibold text-slate-400">(đã huỷ)</span>}
                </td>
                <td className="px-3 py-2 text-center text-slate-600">{receipt ? formatDateShort(receipt.occurredAt) : '—'}</td>
                <td className="px-3 py-2 text-center font-semibold text-slate-900">{formatVnd(item.originalAmount)}</td>
                <td className="px-3 py-2 text-center text-slate-700">{item.paidAmount > 0 ? formatVnd(item.paidAmount) : '—'}</td>
                <td className={`px-3 py-2 text-center font-bold ${item.dueAmount > 0 ? 'text-slate-900' : 'text-emerald-600'}`}>{formatVnd(item.dueAmount)}</td>
                <td className="px-3 py-2 text-center">
                  <StatusBadge tone={statusInfo.tone}>{statusInfo.label}</StatusBadge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const ISSUE_STATUS_LABEL: Record<'DRAFT' | 'POSTED' | 'REJECTED' | 'VOIDED', { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  POSTED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  VOIDED: { label: 'Đã huỷ', tone: 'neutral' },
};

/** Phần C — tab "Phiếu trả hàng": mọi `stock_issue` loại `RETURN_TO_SUPPLIER` gắn NCC này (Nháp lẫn
 * đã Duyệt/Từ chối/Huỷ) — CHỈ phiếu ĐÃ DUYỆT mới thật sự trừ công nợ (xem tab "Sổ công nợ"). */
function ReturnsTab({ supplierId }: { supplierId: string }) {
  const query = useStockIssuesQuery({ supplierId, issueType: 'RETURN_TO_SUPPLIER', limit: 100 });
  const [viewIssueId, setViewIssueId] = useState<string | null>(null);

  if (query.isError) {
    return <ErrorBanner message="Không tải được danh sách phiếu trả hàng." onRetry={() => void query.refetch()} />;
  }
  if (query.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState icon={ArrowUUpLeft} title="Chưa có phiếu trả hàng nào" description="Lập &quot;Phiếu xuất kho&quot; loại &quot;Xuất trả nhà cung cấp&quot; để trả hàng cho NCC này." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
            <th className="px-3 py-2.5 text-center">Mã phiếu</th>
            <th className="px-3 py-2.5 text-center">Ngày</th>
            <th className="px-3 py-2.5 text-center">Phiếu nhập gốc</th>
            <th className="px-3 py-2.5 text-left">Lý do</th>
            <th className="px-3 py-2.5 text-center">Giá trị trả</th>
            <th className="px-3 py-2.5 text-center">Trạng thái</th>
            <th className="px-3 py-2.5 text-center">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-slate-200 last:border-0">
              <td className="px-3 py-2 text-center font-semibold text-slate-800">{it.issueNo}</td>
              <td className="px-3 py-2 text-center text-slate-600">{formatDateShort(it.occurredAt)}</td>
              <td className="px-3 py-2 text-center text-slate-600">{it.sourceReceiptNo ?? '—'}</td>
              <td className="px-3 py-2 text-left font-medium text-slate-700">{it.note ?? '—'}</td>
              <td className="px-3 py-2 text-center font-bold text-slate-900">{formatVnd(it.totalAmount)}</td>
              <td className="px-3 py-2 text-center">
                <StatusBadge tone={ISSUE_STATUS_LABEL[it.status].tone}>{ISSUE_STATUS_LABEL[it.status].label}</StatusBadge>
              </td>
              <td className="px-3 py-2 text-center">
                <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => setViewIssueId(it.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {viewIssueId && <StockIssueDetailDialog issueId={viewIssueId} onClose={() => setViewIssueId(null)} />}
    </div>
  );
}

function LedgerTab({ supplierId }: { supplierId: string }) {
  const query = useSupplierDebtLedgerQuery(supplierId, {});

  if (query.isError) {
    return <ErrorBanner message="Không tải được Sổ công nợ." onRetry={() => query.refetch()} />;
  }
  if (query.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState icon={Scales} title="Sổ công nợ trống" description="Chưa có bút toán nào." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
            <th className="px-3 py-2.5 text-center">Ngày chứng từ</th>
            <th className="px-3 py-2.5 text-center">Ghi sổ lúc</th>
            <th className="px-3 py-2.5 text-center">Loại</th>
            <th className="px-3 py-2.5 text-center">Tăng nợ</th>
            <th className="px-3 py-2.5 text-center">Giảm nợ</th>
            <th className="px-3 py-2.5 text-center">Số dư sau</th>
            <th className="px-3 py-2.5 text-left">Người thực hiện</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} className={`border-b border-slate-200 last:border-0 ${e.reversed ? 'text-slate-400 line-through' : ''}`}>
              <td className="px-3 py-2 text-center font-medium text-slate-700">{formatDateShort(e.occurredAt)}</td>
              <td className="px-3 py-2 text-center text-xs font-medium text-slate-500">{formatDateTime(e.createdAt)}</td>
              <td className="px-3 py-2 text-center">
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{ENTRY_TYPE_LABEL[e.entryType]}</span>
                {e.reversed && <div className="mt-0.5 text-[11px] font-semibold text-slate-400">đã bị đảo</div>}
              </td>
              <td className="px-3 py-2 text-center font-semibold text-amber-700">{e.amountChange > 0 ? `+${formatVnd(e.amountChange)}` : ''}</td>
              <td className="px-3 py-2 text-center font-semibold text-emerald-700">{e.amountChange < 0 ? `−${formatVnd(Math.abs(e.amountChange))}` : ''}</td>
              <td className="px-3 py-2 text-center font-bold text-slate-900">{formatVnd(e.balanceAfter)}</td>
              <td className="px-3 py-2 text-left font-medium text-slate-600">{e.createdByName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PAYMENT_STATUS_LABEL: Record<SupplierDebtPayment['status'], { label: string; tone: StatusBadgeTone }> = {
  POSTED: { label: 'Đã ghi sổ', tone: 'success' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', tone: 'warning' },
  REJECTED: { label: 'Đã từ chối', tone: 'danger' },
};

/** Phần B — tab "Thanh toán": mọi `cash_voucher` gắn NCC này (Trả ngay lúc nhập LẪN Thanh toán công
 * nợ đứng riêng), mới→cũ. Không phân trang/lọc riêng (quy mô nhỏ/NCC) — trang `/suppliers/payments`
 * mới có bộ lọc đầy đủ cho MỌI NCC. */
function PaymentsTab({ supplierId }: { supplierId: string }) {
  const query = useSupplierDebtPaymentsQuery({ supplierId });
  const [viewVoucherId, setViewVoucherId] = useState<string | null>(null);

  if (query.isError) {
    return <ErrorBanner message="Không tải được danh sách thanh toán." onRetry={() => query.refetch()} />;
  }
  if (query.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState icon={HandCoins} title="Chưa có khoản thanh toán nào" description="Trả ngay lúc nhập hàng hoặc bấm &quot;Thanh toán công nợ&quot; để ghi nhận." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
            <th className="px-3 py-2.5 text-center">Mã phiếu</th>
            <th className="px-3 py-2.5 text-center">Ngày</th>
            <th className="px-3 py-2.5 text-left">Diễn giải</th>
            <th className="px-3 py-2.5 text-center">Số tiền</th>
            <th className="px-3 py-2.5 text-center">Trạng thái</th>
            <th className="px-3 py-2.5 text-center">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className={`border-b border-slate-200 last:border-0 ${p.voided ? 'opacity-50' : ''}`}>
              <td className="px-3 py-2 text-center font-semibold text-slate-800">
                {p.voucherNo}
                {p.voided && <span className="ml-1.5 text-[11px] font-semibold text-slate-400">(đã huỷ)</span>}
              </td>
              <td className="px-3 py-2 text-center text-slate-600">{formatDateShort(p.occurredAt)}</td>
              <td className="px-3 py-2 text-left font-medium text-slate-900">{p.description}</td>
              <td className="px-3 py-2 text-center font-bold text-emerald-700">−{formatVnd(p.amount)}</td>
              <td className="px-3 py-2 text-center">
                <StatusBadge tone={PAYMENT_STATUS_LABEL[p.status].tone}>{PAYMENT_STATUS_LABEL[p.status].label}</StatusBadge>
              </td>
              <td className="px-3 py-2 text-center">
                <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => setViewVoucherId(p.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {viewVoucherId && <CashVoucherDetailDialog voucherId={viewVoucherId} onClose={() => setViewVoucherId(null)} />}
    </div>
  );
}

const ADJUSTMENT_KIND_LABEL: Record<SupplierDebtAdjustment['kind'], string> = {
  INCREASE: 'Điều chỉnh tăng',
  DECREASE: 'Điều chỉnh giảm',
  VOID_REQUEST: 'Đề nghị huỷ',
};

const ADJUSTMENT_STATUS_LABEL: Record<SupplierDebtAdjustment['status'], { label: string; tone: StatusBadgeTone }> = {
  PENDING_APPROVAL: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Đã từ chối', tone: 'danger' },
};

/** Phần D — tab "Nhật ký điều chỉnh": mọi Phiếu điều chỉnh/Đề nghị huỷ của NCC này, mới→cũ (server
 * không sắp thứ tự tường minh — `listAdjustments()` trả theo `createdAt DESC`, đúng khuôn các tab
 * khác). Nút "Xem" mở `SupplierDebtAdjustmentDetailDialog` dùng chung với badge "Có điều chỉnh" ở
 * `StockReceiptFormPage.tsx`/`StockIssueFormPage.tsx`. */
function AdjustmentsTab({ supplierId }: { supplierId: string }) {
  const query = useSupplierDebtAdjustmentsQuery({ supplierId });
  const [viewingId, setViewingId] = useState<string | null>(null);

  if (query.isError) {
    return <ErrorBanner message="Không tải được nhật ký điều chỉnh." onRetry={() => void query.refetch()} />;
  }
  if (query.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  const items = query.data?.items ?? [];
  const viewing = items.find((a) => a.id === viewingId) ?? null;
  if (items.length === 0) {
    return <EmptyState icon={Warning} title="Chưa có điều chỉnh nào" description="Phiếu điều chỉnh công nợ/Đề nghị huỷ chứng từ sẽ hiện ở đây." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
            <th className="px-3 py-2.5 text-center">Mã phiếu</th>
            <th className="px-3 py-2.5 text-center">Loại</th>
            <th className="px-3 py-2.5 text-center">Số tiền</th>
            <th className="px-3 py-2.5 text-left">Người đề nghị</th>
            <th className="px-3 py-2.5 text-left">Người duyệt</th>
            <th className="px-3 py-2.5 text-center">Trạng thái</th>
            <th className="px-3 py-2.5 text-center">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-b border-slate-200 last:border-0">
              <td className="px-3 py-2 text-center font-semibold text-slate-800">{a.adjustmentNo}</td>
              <td className="px-3 py-2 text-center">
                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{ADJUSTMENT_KIND_LABEL[a.kind]}</span>
              </td>
              <td className="px-3 py-2 text-center font-bold text-slate-900">{a.amount !== null ? formatVnd(a.amount) : '—'}</td>
              <td className="px-3 py-2 text-left font-medium text-slate-600">{a.createdByName}</td>
              <td className="px-3 py-2 text-left font-medium text-slate-600">
                {a.approvedByName ?? '—'}
                {a.selfApproved && a.status === 'APPROVED' && <span className="ml-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">Tự duyệt</span>}
              </td>
              <td className="px-3 py-2 text-center">
                <StatusBadge tone={ADJUSTMENT_STATUS_LABEL[a.status].tone}>{ADJUSTMENT_STATUS_LABEL[a.status].label}</StatusBadge>
              </td>
              <td className="px-3 py-2 text-center">
                <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => setViewingId(a.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {viewing && <SupplierDebtAdjustmentDetailDialog adjustment={viewing} onClose={() => setViewingId(null)} />}
    </div>
  );
}

const RECONCILIATION_STATUS_LABEL: Record<SupplierDebtReconciliation['status'], { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  FINALIZED: { label: 'Đã chốt', tone: 'success' },
  CANCELLED: { label: 'Đã huỷ', tone: 'danger' },
};

/** Nút "Chốt" cho 1 dòng biên bản còn `DRAFT` — tự quản lý lỗi riêng (409 `NOT_READY` khi phiếu điều
 * chỉnh liên kết còn Chờ duyệt), không dùng chung `error` của cả tab để không che các dòng khác. */
function FinalizeReconciliationButton({ supplierId, reconciliation }: { supplierId: string; reconciliation: SupplierDebtReconciliation }) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useFinalizeSupplierDebtReconciliationMutation(supplierId);
  const blocked = reconciliation.resultingAdjustmentStatus === 'PENDING_APPROVAL';

  async function handleClick() {
    setError(null);
    try {
      await mutation.mutateAsync({ id: reconciliation.id, body: { version: reconciliation.version } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="secondary" loading={mutation.isPending} disabled={blocked} onClick={() => void handleClick()}>
        Chốt
      </Button>
      {blocked && <p className="text-[11px] font-medium text-amber-700">Chờ duyệt phiếu điều chỉnh</p>}
      {error && <p className="max-w-[220px] text-right text-[11px] font-medium text-rose-600">{error}</p>}
    </div>
  );
}

/** Phần E — tab "Đối chiếu & Chốt kỳ": lịch sử "Biên bản đối chiếu" của NCC này, mới→cũ. Nút "Xem
 * điều chỉnh" mở lại `SupplierDebtAdjustmentDetailDialog` dùng chung (đúng khuôn `AdjustmentsTab`) —
 * tra theo `resultingAdjustmentId` trong CÙNG danh sách đã tải cho tab "Nhật ký điều chỉnh" (react-
 * query tự cache theo key, không gọi API 2 lần). */
function ReconciliationsTab({ supplierId }: { supplierId: string }) {
  const query = useSupplierDebtReconciliationsQuery(supplierId);
  const adjustmentsQuery = useSupplierDebtAdjustmentsQuery({ supplierId });
  const [viewingAdjustmentId, setViewingAdjustmentId] = useState<string | null>(null);

  if (query.isError) {
    return <ErrorBanner message="Không tải được lịch sử đối chiếu." onRetry={() => void query.refetch()} />;
  }
  if (query.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  const items = query.data?.items ?? [];
  const viewingAdjustment = adjustmentsQuery.data?.items.find((a) => a.id === viewingAdjustmentId) ?? null;
  if (items.length === 0) {
    return <EmptyState icon={Scales} title="Chưa có biên bản đối chiếu nào" description="Bấm &quot;Lập biên bản đối chiếu&quot; để đối chiếu công nợ với NCC tại 1 mốc ngày." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
            <th className="px-3 py-2.5 text-center">Mã biên bản</th>
            <th className="px-3 py-2.5 text-center">Ngày đối chiếu</th>
            <th className="px-3 py-2.5 text-center">Số hệ thống</th>
            <th className="px-3 py-2.5 text-center">NCC xác nhận</th>
            <th className="px-3 py-2.5 text-center">Chênh lệch</th>
            <th className="px-3 py-2.5 text-center">Trạng thái</th>
            <th className="px-3 py-2.5 text-center">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-b border-slate-200 last:border-0">
              <td className="px-3 py-2 text-center font-semibold text-slate-800">{r.reconciliationNo}</td>
              <td className="px-3 py-2 text-center text-slate-600">{formatDateShort(r.asOfDate)}</td>
              <td className="px-3 py-2 text-center font-medium text-slate-700">{formatVnd(r.systemBalance)}</td>
              <td className="px-3 py-2 text-center font-medium text-slate-700">{formatVnd(r.confirmedBalance)}</td>
              <td className={`px-3 py-2 text-center font-bold ${r.differenceAmount === 0 ? 'text-emerald-600' : 'text-amber-700'}`}>
                {r.differenceAmount === 0 ? 'Khớp' : formatVnd(r.differenceAmount)}
              </td>
              <td className="px-3 py-2 text-center">
                <StatusBadge tone={RECONCILIATION_STATUS_LABEL[r.status].tone}>{RECONCILIATION_STATUS_LABEL[r.status].label}</StatusBadge>
                {r.resultingAdjustmentId && (
                  <button type="button" onClick={() => setViewingAdjustmentId(r.resultingAdjustmentId)} className="ml-1.5 text-[11px] font-semibold text-blue-600 underline">
                    Xem điều chỉnh
                  </button>
                )}
              </td>
              <td className="px-3 py-2 text-center">
                {r.status === 'DRAFT' ? <FinalizeReconciliationButton supplierId={supplierId} reconciliation={r} /> : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {viewingAdjustment && <SupplierDebtAdjustmentDetailDialog adjustment={viewingAdjustment} onClose={() => setViewingAdjustmentId(null)} />}
    </div>
  );
}

function OpeningBalanceDialog({ supplierId, supplierName, onClose }: { supplierId: string; supplierName: string; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useRecordSupplierDebtOpeningBalanceMutation(supplierId);

  const parsedAmount = Number(amount);
  const isInvalid = amount.trim() === '' || Number.isNaN(parsedAmount) || parsedAmount === 0 || !occurredAt;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) return;
    setError(null);
    try {
      await mutation.mutateAsync({ amount: parsedAmount, occurredAt, note: note.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onSubmit={handleSubmit}>
        <ModalHeader icon={ClipboardText} title="Khai nợ đầu kỳ" subtitle={supplierName} onClose={onClose} />
        {error && <ErrorBanner message={error} />}
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="opening-amount" className="text-sm font-semibold text-slate-800">
              Số nợ đầu kỳ
            </label>
            <input
              id="opening-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <p className="text-xs text-slate-500">Nhập số âm nếu NCC đang nợ lại phòng khám.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="opening-date" className="text-sm font-semibold text-slate-800">
              Tính đến ngày
            </label>
            <input
              id="opening-date"
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="opening-note" className="text-sm font-semibold text-slate-800">
              Căn cứ / số biên bản
            </label>
            <input
              id="opening-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Biên bản đối chiếu 31/08"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900">
            Chỉ khai được 1 lần, chỉ khi NCC chưa có phát sinh nào trên phần mềm. Khai sai → sửa bằng Phiếu điều chỉnh (có duyệt, sẽ có ở giai đoạn sau).
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={isInvalid}>
            Lưu nợ đầu kỳ
          </Button>
        </div>
      </form>
    </div>
  );
}

function todayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Phần B — "Thanh toán công nợ" trên TỔNG nợ (không chọn từng phiếu, phân bổ FIFO ngầm ở backend —
 * `allocateSupplierDebt()`). Server tự sinh `description`/mã phiếu, KHÔNG nhận từ client (đúng khuôn
 * "Trả ngay" ở `StockReceiptFormPage.tsx`) — dialog chỉ hỏi số tiền/phương thức/quỹ/ngày/ghi chú. */
function PaymentDialog({ supplierId, supplierName, balance, onClose }: { supplierId: string; supplierName: string; balance: number; onClose: () => void }) {
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [paymentMethodCode, setPaymentMethodCode] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayDateString());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useRecordSupplierDebtPaymentMutation(supplierId);
  const clinicSettingsQuery = useClinicSettingsQuery();
  const paymentMethodQuery = useReferenceCatalogQuery('PAYMENT_METHOD');
  const cashAccountsQuery = useCashAccountsQuery();

  const paymentMethods = useMemo(() => paymentMethodQuery.data?.items.filter((i) => i.isActive) ?? [], [paymentMethodQuery.data]);
  const cashAccounts = useMemo(() => cashAccountsQuery.data?.items.filter((a) => a.isActive) ?? [], [cashAccountsQuery.data]);

  const exceedsBalance = (amount ?? 0) > balance;
  const isInvalid = !amount || amount <= 0 || exceedsBalance || paymentMethodCode === '' || cashAccountId === '' || !occurredAt;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid || !amount) return;
    setError(null);
    try {
      await mutation.mutateAsync({ amount, paymentMethodCode, cashAccountId, occurredAt, note: note.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onSubmit={handleSubmit}>
        <div className="flex-shrink-0 px-6 pt-6">
          <ModalHeader icon={HandCoins} title="Thanh toán công nợ" subtitle={supplierName} onClose={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          {error && <ErrorBanner message={error} />}
          <div className="my-4 flex flex-col gap-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-600">Công nợ hiện tại</span>
                <span className="font-bold text-slate-900">{formatVnd(balance)}</span>
              </div>
            </div>

            <BoxedSection badge="Thanh toán">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="payment-amount" className="text-sm font-semibold text-slate-800">
                    Số tiền <span className="text-rose-500">*</span>
                  </label>
                  <MoneyInput
                    id="payment-amount"
                    value={amount}
                    onChange={setAmount}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAmount(balance)}
                      className="rounded-full border-2 border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 transition-colors hover:border-blue-400 hover:bg-brand-teal-tint"
                    >
                      Trả hết {formatVnd(balance)}
                    </button>
                  </div>
                  {exceedsBalance && <p className="text-xs font-semibold text-rose-600">Số tiền thanh toán không được vượt quá công nợ hiện tại.</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="payment-date" className="text-sm font-semibold text-slate-800">
                    Ngày phát sinh
                  </label>
                  <DateInput id="payment-date" value={occurredAt} onChange={setOccurredAt} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="payment-method" className="text-sm font-semibold text-slate-800">
                    Phương thức <span className="text-rose-500">*</span>
                  </label>
                  <Combobox
                    id="payment-method"
                    value={paymentMethodCode}
                    onChange={setPaymentMethodCode}
                    placeholder="— Chọn —"
                    options={paymentMethods.map((m) => ({ value: m.code, label: m.name }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="payment-account" className="text-sm font-semibold text-slate-800">
                    Quỹ <span className="text-rose-500">*</span>
                  </label>
                  <Combobox
                    id="payment-account"
                    value={cashAccountId}
                    onChange={setCashAccountId}
                    placeholder="— Chọn —"
                    options={cashAccounts.map((a) => ({ value: a.id, label: a.name }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="payment-note" className="text-sm font-semibold text-slate-800">
                    Ghi chú
                  </label>
                  <textarea
                    id="payment-note"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            </BoxedSection>

            {amount !== undefined && amount > 0 && !exceedsBalance && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
                <div className="flex justify-between gap-3 font-semibold text-blue-900">
                  <span>Công nợ sau khi thanh toán</span>
                  <span className="text-lg font-bold">{formatVnd(balance - amount)}</span>
                </div>
              </div>
            )}
            {clinicSettingsQuery.data?.cashVoucherApprovalEnabled && (
              <p className="text-xs font-medium text-amber-700">Phiếu chi cần được duyệt trước khi công nợ giảm — xem tại tab "Thanh toán" sau khi lập.</p>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Huỷ
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={isInvalid}>
            Xác nhận thanh toán
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Phần C — "Thu tiền NCC hoàn lại" (Q8), CHỈ hiện khi `balance < 0` (NCC đang nợ lại phòng khám).
 * Cùng khuôn `PaymentDialog` ở trên (server tự sinh mã/diễn giải, LUÔN `POSTED` ngay — không có
 * đường Chờ duyệt cho phiếu thu, khác phiếu chi). */
function RefundDialog({ supplierId, supplierName, balance, onClose }: { supplierId: string; supplierName: string; balance: number; onClose: () => void }) {
  const maxRefundable = Math.abs(balance);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [paymentMethodCode, setPaymentMethodCode] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayDateString());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useRecordSupplierDebtRefundMutation(supplierId);
  const paymentMethodQuery = useReferenceCatalogQuery('PAYMENT_METHOD');
  const cashAccountsQuery = useCashAccountsQuery();

  const paymentMethods = useMemo(() => paymentMethodQuery.data?.items.filter((i) => i.isActive) ?? [], [paymentMethodQuery.data]);
  const cashAccounts = useMemo(() => cashAccountsQuery.data?.items.filter((a) => a.isActive) ?? [], [cashAccountsQuery.data]);

  const exceedsBalance = (amount ?? 0) > maxRefundable;
  const isInvalid = !amount || amount <= 0 || exceedsBalance || paymentMethodCode === '' || cashAccountId === '' || !occurredAt;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid || !amount) return;
    setError(null);
    try {
      await mutation.mutateAsync({ amount, paymentMethodCode, cashAccountId, occurredAt, note: note.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onSubmit={handleSubmit}>
        <div className="flex-shrink-0 px-6 pt-6">
          <ModalHeader icon={ArrowUUpLeft} title="Thu tiền NCC hoàn lại" subtitle={supplierName} onClose={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          {error && <ErrorBanner message={error} />}
          <div className="my-4 flex flex-col gap-4">
            <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-blue-800">Nhà cung cấp đang nợ lại phòng khám</span>
                <span className="font-bold text-blue-700">{formatVnd(maxRefundable)}</span>
              </div>
            </div>

            <BoxedSection badge="Thu tiền">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="refund-amount" className="text-sm font-semibold text-slate-800">
                    Số tiền nhận <span className="text-rose-500">*</span>
                  </label>
                  <MoneyInput
                    id="refund-amount"
                    value={amount}
                    onChange={setAmount}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAmount(maxRefundable)}
                      className="rounded-full border-2 border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 transition-colors hover:border-blue-400 hover:bg-brand-teal-tint"
                    >
                      Toàn bộ {formatVnd(maxRefundable)}
                    </button>
                  </div>
                  {exceedsBalance && <p className="text-xs font-semibold text-rose-600">Số tiền nhận không được vượt quá số nhà cung cấp đang nợ lại.</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="refund-date" className="text-sm font-semibold text-slate-800">
                    Ngày thu
                  </label>
                  <DateInput id="refund-date" value={occurredAt} onChange={setOccurredAt} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="refund-method" className="text-sm font-semibold text-slate-800">
                    Phương thức <span className="text-rose-500">*</span>
                  </label>
                  <Combobox
                    id="refund-method"
                    value={paymentMethodCode}
                    onChange={setPaymentMethodCode}
                    placeholder="— Chọn —"
                    options={paymentMethods.map((m) => ({ value: m.code, label: m.name }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="refund-account" className="text-sm font-semibold text-slate-800">
                    Quỹ nhận <span className="text-rose-500">*</span>
                  </label>
                  <Combobox
                    id="refund-account"
                    value={cashAccountId}
                    onChange={setCashAccountId}
                    placeholder="— Chọn —"
                    options={cashAccounts.map((a) => ({ value: a.id, label: a.name }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="refund-note" className="text-sm font-semibold text-slate-800">
                    Ghi chú
                  </label>
                  <textarea
                    id="refund-note"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            </BoxedSection>

            {amount !== undefined && amount > 0 && !exceedsBalance && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
                <div className="flex justify-between gap-3 font-semibold text-blue-900">
                  <span>Còn nợ lại sau khi thu</span>
                  <span className="text-lg font-bold">{formatVnd(maxRefundable - amount)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Huỷ
          </Button>
          <Button type="submit" loading={mutation.isPending} disabled={isInvalid}>
            Lập phiếu thu
          </Button>
        </div>
      </form>
    </div>
  );
}
