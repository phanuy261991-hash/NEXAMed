import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DownloadSimple, Eye, Package, PencilSimple, Plus, Printer, ShoppingCart, X } from '@phosphor-icons/react';
import type { ListPurchaseOrdersQuery, PurchaseOrderDetail, PurchaseOrderStatus, PurchaseOrderSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { TabBar } from '../../shared/ui/TabBar';
import { PrintButton } from '../../shared/print/PrintButton';
import { ReportPrintAction } from '../../shared/print/ReportPrintAction';
import { loadAllByCursor, PRINT_LOAD_PAGE_SIZE } from '../../shared/print/load-all-pages';
import { REPORT_PRINT_ROW_CAP, type ReportPrintSpec } from '../../shared/print/report-print-spec';
import { formatVnd } from '../../shared/format/currency';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { showBranchInfo } from '../branch/branch-visibility';
import { useSuppliersQuery } from '../drug/supplier.queries';
import { buildPurchaseOrderListPrintSpec } from '../report/report-print-builders';
import { getPurchaseOrder, getPurchaseOrders } from './purchase-order.api';
import { useCancelPurchaseOrderMutation, useExportPurchaseOrdersMutation, usePurchaseOrderOptionsQuery, usePurchaseOrderPendingCountsQuery, usePurchaseOrdersQuery } from './purchase-order.queries';
import { canReceiveOrder, ORDER_STATUS_META, ORDER_STATUS_ORDER, orderActionsFor, orderStatusMeta } from './purchase-order-meta';
import { PurchaseOrderPrintView } from './PurchaseOrderPrintView';
import { formatDayVn } from './stock-request-meta';

type View = 'mine' | 'approval';

const ROW_HEIGHT_PX = 60;
const PAGE_LIMIT = 50;
// Cột co giãn (minmax + fr) để vừa màn 1280px; thêm tên chi nhánh dưới tên kho khi công ty có từ 2 chi nhánh (`ui-guidelines.md` mục 14/15).
const GRID = '110px minmax(150px,1.3fr) minmax(140px,1fr) 56px 110px minmax(130px,1fr) 140px 232px';
const MIN_WIDTH = 1190;

function formatDateShort(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/**
 * "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 giai đoạn 2, mockup màn 7). Hai tab: "Đơn của chi nhánh này" và "Cần tôi duyệt" (đơn chờ duyệt mà người xem được duyệt).
 * Dải đếm theo trạng thái, lọc ngày/nhà cung cấp, Xuất Excel và In danh sách (quy tắc #287); mỗi dòng có Nhận hàng/Xem/In/Sửa/Huỷ.
 */
export function PurchaseOrderListPage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Đơn đặt hàng NCC' }]);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const multiBranch = showBranchInfo(user);
  const canCreate = useHasPermission('purchase_order', 'create');
  const canApprove = useHasPermission('purchase_order', 'approve');
  const canReceipt = useHasPermission('stock_receipt', 'create');

  const [view, setView] = useState<View>('mine');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const [supplierId, setSupplierId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrderSummary | null>(null);
  const [printing, setPrinting] = useState<PurchaseOrderDetail | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  const baseQuery: ListPurchaseOrdersQuery = {
    view,
    limit: PAGE_LIMIT,
    status: status || undefined,
    supplierId: supplierId || undefined,
    from: from || undefined,
    to: to || undefined,
    q: debouncedQ.trim() || undefined,
  };
  const listQuery = usePurchaseOrdersQuery({ ...baseQuery, cursor: cursorStack[cursorStack.length - 1] });
  const suppliersQuery = useSuppliersQuery();
  const optionsQuery = usePurchaseOrderOptionsQuery();
  const pendingCounts = usePurchaseOrderPendingCountsQuery(canApprove);
  const exportMutation = useExportPurchaseOrdersMutation();

  const items = listQuery.data?.items ?? [];
  const statusCounts = listQuery.data?.statusCounts;
  const toApprove = pendingCounts.data?.toApprove ?? 0;
  const canOrderHere = optionsQuery.data?.canOrderHere !== false;

  function resetPaging() {
    setCursorStack([]);
  }

  function changeView(next: View) {
    setView(next);
    setStatus('');
    setSupplierId('');
    resetPaging();
  }

  const filterLabels = useMemo(() => {
    const labels: string[] = [];
    if (status) labels.push(`Trạng thái: ${ORDER_STATUS_META[status].label}`);
    if (supplierId) labels.push(`Nhà cung cấp: ${suppliersQuery.data?.items.find((s) => s.id === supplierId)?.name ?? ''}`);
    if (from || to) labels.push(`Ngày lập: ${from ? formatDayVn(from) : '...'} đến ${to ? formatDayVn(to) : '...'}`);
    return labels;
  }, [status, supplierId, from, to, suppliersQuery.data]);

  /** In danh sách: tải đủ mọi trang theo bộ lọc hiện tại (không chỉ phần đang xem) rồi dựng bản in. */
  async function loadPrintSpec(): Promise<ReportPrintSpec> {
    const { pages, capped } = await loadAllByCursor((cursor) => getPurchaseOrders({ ...baseQuery, limit: PRINT_LOAD_PAGE_SIZE, cursor }), REPORT_PRINT_ROW_CAP);
    const all = pages.flatMap((p) => p.items).slice(0, REPORT_PRINT_ROW_CAP);
    const spec = buildPurchaseOrderListPrintSpec(all, { view, filterLabels, multiBranch });
    return capped ? { ...spec, note: `Chỉ in ${REPORT_PRINT_ROW_CAP.toLocaleString('vi-VN')} dòng đầu theo bộ lọc hiện tại.` } : spec;
  }

  /** In một đơn từ hàng: tải chi tiết rồi mở hộp in (bản in cần đủ dòng hàng). */
  async function printRow(item: PurchaseOrderSummary) {
    setPrintError(null);
    try {
      const detail = await getPurchaseOrder(item.id);
      setPrinting(detail);
      setTimeout(() => {
        window.print();
        setPrinting(null);
      }, 150);
    } catch (err) {
      setPrintError(err instanceof ApiError ? err.message : 'Không tải được đơn để in, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Đơn đặt hàng NCC</h1>

      {canApprove && (
        <TabBar
          variant="underline"
          active={view}
          onChange={changeView}
          className="flex-shrink-0 px-1"
          tabs={[
            { id: 'mine', label: 'Đơn của chi nhánh này' },
            { id: 'approval', label: 'Cần tôi duyệt', badge: toApprove },
          ]}
        />
      )}

      <div className="flex flex-shrink-0 flex-wrap items-end justify-between gap-2.5 px-1">
        <div className="flex flex-wrap items-end gap-2.5">
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPaging();
            }}
            placeholder="Tìm theo số đơn, nhà cung cấp..."
            aria-label="Tìm theo số đơn hoặc nhà cung cấp"
            className="w-60 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <Combobox
            id="order-filter-supplier"
            value={supplierId}
            onChange={(v) => {
              setSupplierId(v);
              resetPaging();
            }}
            options={[{ value: '', label: 'Nhà cung cấp: Tất cả' }, ...(suppliersQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))]}
          />
          {view === 'mine' && (
            <Combobox
              id="order-filter-status"
              value={status}
              onChange={(v) => {
                setStatus(v as PurchaseOrderStatus | '');
                resetPaging();
              }}
              options={[{ value: '', label: 'Trạng thái: Tất cả' }, ...ORDER_STATUS_ORDER.map((s) => ({ value: s, label: ORDER_STATUS_META[s].label }))]}
            />
          )}
          <div className="flex items-center gap-1.5">
            <DateInput id="order-filter-from" value={from} onChange={(v) => { setFrom(v); resetPaging(); }} dense />
            <span className="text-sm text-slate-500">đến</span>
            <DateInput id="order-filter-to" value={to} onChange={(v) => { setTo(v); resetPaging(); }} dense />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" loading={exportMutation.isPending} onClick={() => exportMutation.mutate({ ...baseQuery, limit: PAGE_LIMIT })}>
            <DownloadSimple size={16} weight="bold" aria-hidden="true" />
            Xuất Excel
          </Button>
          <ReportPrintAction loadSpec={loadPrintSpec} label="In danh sách" />
          {canCreate && view === 'mine' && canOrderHere && (
            <Button type="button" onClick={() => navigate('/inventory/purchase-orders/new')}>
              <Plus size={16} weight="bold" aria-hidden="true" />
              Lập đơn đặt hàng
            </Button>
          )}
        </div>
      </div>

      {statusCounts && view === 'mine' && (
        <div className="flex-shrink-0 px-1">
          {/* Dải đếm đúng mockup màn 7: nhãn nhỏ phía trên, số lớn tô màu phía dưới, cùng kiểu dải đếm của danh sách Yêu cầu cấp hàng */}
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-5">
            {[
              { label: 'Chờ duyệt', value: statusCounts.PENDING_APPROVAL ?? 0, tone: 'text-amber-700' },
              { label: 'Đã đặt NCC', value: statusCounts.ORDERED ?? 0, tone: 'text-blue-600' },
              { label: 'Nhận một phần', value: statusCounts.PARTIALLY_RECEIVED ?? 0, tone: 'text-slate-900' },
              { label: 'Đã nhận đủ', value: statusCounts.RECEIVED ?? 0, tone: 'text-emerald-600' },
              { label: 'Từ chối / Huỷ', value: (statusCounts.REJECTED ?? 0) + (statusCounts.CANCELLED ?? 0), tone: 'text-rose-600' },
            ].map((stat, index) => (
              <div key={stat.label} className={`px-3.5 py-2 ${index > 0 ? 'sm:border-l sm:border-slate-200' : ''}`}>
                <span className="block text-[13px] font-medium text-slate-600">{stat.label}</span>
                <span className={`text-xl font-semibold tabular-nums ${stat.tone}`}>{stat.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'approval' && toApprove > 0 && (
        <div role="status" className="flex-shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Có <strong>{toApprove} đơn</strong> đang chờ bạn duyệt.
        </div>
      )}

      {printError && <ErrorBanner message={printError} onRetry={() => setPrintError(null)} />}
      {listQuery.isError && (
        <ErrorBanner message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách đơn đặt hàng.'} onRetry={() => void listQuery.refetch()} />
      )}

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState
          icon={ShoppingCart}
          title={view === 'approval' ? 'Không có đơn nào đang chờ bạn duyệt' : 'Chưa có đơn đặt hàng nào'}
          description={view === 'approval' ? 'Đơn hiện ở đây khi chi nhánh lập đơn bấm Gửi duyệt.' : 'Lập đơn để đặt hàng từ nhà cung cấp, rồi nhận hàng bằng Phiếu nhập kho.'}
        />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách đơn đặt hàng NCC" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: MIN_WIDTH }}>
              <div role="row" style={{ gridTemplateColumns: GRID }} className="grid flex-shrink-0 gap-x-3 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-center">Số đơn</div>
                <div role="columnheader" className="py-2.5 text-left">Nhà cung cấp</div>
                <div role="columnheader" className="py-2.5 text-left">{multiBranch ? 'Kho nhận (chi nhánh)' : 'Kho nhận'}</div>
                <div role="columnheader" className="py-2.5 text-center">Số dòng</div>
                <div role="columnheader" className="py-2.5 text-center">Tổng dự kiến</div>
                <div role="columnheader" className="py-2.5 text-left">Tiến độ nhận</div>
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => {
                  const meta = orderStatusMeta(item.status, item.requiresMainApproval);
                  const acts = orderActionsFor(item.status);
                  const mine = view === 'mine';
                  const placed = canReceiveOrder(item.status) || item.status === 'RECEIVED' || item.status === 'CLOSED';
                  const percent = item.lineCount > 0 ? Math.round((item.receivedLineCount / item.lineCount) * 100) : 0;
                  return (
                    <div
                      key={item.id}
                      role="row"
                      style={{ gridTemplateColumns: GRID, minHeight: ROW_HEIGHT_PX }}
                      className={`grid items-center gap-x-3 border-b border-slate-100 px-4 text-sm hover:bg-slate-50 ${item.status === 'PENDING_APPROVAL' ? 'bg-amber-50/50 hover:bg-amber-50' : ''} ${['REJECTED', 'CANCELLED', 'CLOSED'].includes(item.status) ? 'opacity-70' : ''}`}
                    >
                      <div role="cell" className="min-w-0 text-center">
                        <p className="truncate font-semibold text-slate-800">{item.orderNo}</p>
                        <p className="text-xs font-medium text-slate-500">{formatDateShort(item.createdAt)}</p>
                      </div>
                      <div role="cell" className="min-w-0 text-left">
                        <p className="truncate font-semibold text-slate-900" title={item.supplierName}>{item.supplierName}</p>
                        <p className="truncate text-xs font-medium text-slate-500">{item.expectedDate ? `Giao dự kiến ${formatDayVn(item.expectedDate)}` : item.createdByName}</p>
                      </div>
                      <div role="cell" className="min-w-0 text-left">
                        <p className="truncate font-semibold text-slate-900" title={item.warehouseName}>{item.warehouseName}</p>
                        {multiBranch && <p className="truncate text-xs font-medium text-slate-500">{item.branchName}</p>}
                      </div>
                      <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{item.lineCount}</div>
                      <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{item.totalAmount > 0 ? formatVnd(item.totalAmount) : '—'}</div>
                      <div role="cell" className="min-w-0 text-left">
                        {placed ? (
                          <>
                            <p className="text-xs font-medium text-slate-600">
                              {item.receivedLineCount} / {item.lineCount} dòng{item.draftReceiptCount > 0 ? ` · ${item.draftReceiptCount} phiếu nhập đang soạn` : ''}
                            </p>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                              <div className="h-full bg-emerald-500" style={{ width: `${percent}%` }} />
                            </div>
                          </>
                        ) : (
                          <span className="text-xs font-medium text-slate-500">Chưa đặt</span>
                        )}
                      </div>
                      <div role="cell" className="flex flex-col items-center gap-0.5">
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        {!mine && <span className="text-[11px] font-medium text-slate-500">{item.branchName}</span>}
                      </div>
                      <div role="cell" className="flex items-center justify-center gap-1.5">
                        {mine && canReceipt && acts.receive && (
                          <Button type="button" variant="info" className="px-2.5 py-1 text-xs" onClick={() => navigate(`/inventory/receipts/new?fromOrder=${item.id}`)}>
                            <Package size={14} weight="bold" aria-hidden="true" />
                            Nhận hàng
                          </Button>
                        )}
                        <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => navigate(`/inventory/purchase-orders/${item.id}`)} />
                        {mine && (
                          <PrintButton
                            documentType="PURCHASE_ORDER"
                            onPrint={() => void printRow(item)}
                            renderTrigger={({ onClick, disabled }) => <RowActionButton icon={Printer} label="In đơn" tone="neutral" onClick={onClick} disabled={disabled} />}
                          />
                        )}
                        {mine && canCreate && acts.edit && <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => navigate(`/inventory/purchase-orders/${item.id}/edit`)} />}
                        {mine && canCreate && acts.cancel && item.status !== 'ORDERED' && <RowActionButton icon={X} label="Huỷ đơn" tone="danger" onClick={() => setCancelTarget(item)} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {listQuery.isSuccess && (cursorStack.length > 0 || listQuery.data.nextCursor) && (
        <div className="flex flex-shrink-0 items-center justify-center gap-2 py-1">
          <Button type="button" variant="secondary" disabled={cursorStack.length === 0} onClick={() => setCursorStack((s) => s.slice(0, -1))}>
            ← Trang trước
          </Button>
          <Button type="button" variant="secondary" disabled={!listQuery.data.nextCursor} onClick={() => setCursorStack((s) => [...s, listQuery.data!.nextCursor!])}>
            Trang sau →
          </Button>
        </div>
      )}

      {cancelTarget && <CancelDialog target={cancelTarget} onClose={() => setCancelTarget(null)} />}
      {printing && <PurchaseOrderPrintView order={printing} />}
    </div>
  );
}

function CancelDialog({ target, onClose }: { target: PurchaseOrderSummary; onClose: () => void }) {
  const mutation = useCancelPurchaseOrderMutation();
  return (
    <ReasonConfirmDialog
      title="Huỷ đơn đặt hàng NCC"
      rows={[{ label: 'Đơn', value: target.orderNo }]}
      note="Các yêu cầu cấp hàng đang chờ đơn này sẽ được gỡ liên kết."
      confirmLabel="Xác nhận huỷ"
      confirmVariant="danger"
      onConfirm={(reason) => mutation.mutateAsync({ id: target.id, body: { reason, version: target.version } })}
      onDone={onClose}
      onClose={onClose}
    />
  );
}
