import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardText, DownloadSimple, Eye, PencilSimple, Plus, Printer, X } from '@phosphor-icons/react';
import type { ListStockRequestsQuery, StockRequestDetail, StockRequestPriority, StockRequestStatus, StockRequestSummary } from '@nexamed/shared';
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
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { showBranchInfo } from '../branch/branch-visibility';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { buildStockRequestListPrintSpec } from '../report/report-print-builders';
import { getStockRequest, getStockRequests } from './stock-request.api';
import { useCancelStockRequestMutation, useExportStockRequestsMutation, useStockRequestPendingCountsQuery, useStockRequestsQuery } from './stock-request.queries';
import { formatDayVn, REQUEST_PRIORITY_LABEL, REQUEST_STATUS_META, REQUEST_STATUS_ORDER, requesterActionsFor } from './stock-request-meta';
import { StockRequestPrintView } from './StockRequestPrintView';
import { StockRequestRestockTab } from './StockRequestRestockTab';

type View = 'mine' | 'incoming' | 'restock';

const ROW_HEIGHT_PX = 60;
const PAGE_LIMIT = 50;
// Cột co giãn (minmax + fr) thay cho px cứng để vừa màn 1280px; thêm cột chi nhánh khi công ty có từ 2 chi nhánh (`ui-guidelines.md` mục 14/15).
const GRID_SINGLE = '120px minmax(150px,1fr) minmax(150px,1fr) 80px 100px 70px 140px minmax(140px,0.9fr) 150px';
const GRID_MULTI = '120px minmax(170px,1.2fr) minmax(170px,1.2fr) 80px 100px 70px 140px minmax(140px,0.9fr) 150px';
const MIN_WIDTH_SINGLE = 1180;
const MIN_WIDTH_MULTI = 1260;

function formatDateShort(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/**
 * "Yêu cầu cấp hàng" (docs/DECISIONS.md #298, mockup màn 2 đã duyệt). Hai tab: "Của tôi" (phiếu của kho thuộc chi nhánh đang làm) và "Cần duyệt" (phiếu xin kho của chi nhánh này,
 * từ lúc đã gửi — chỉ người có quyền duyệt thấy). Dải đếm theo trạng thái, lọc ngày/kho/mức khẩn, Xuất Excel và In danh sách (quy tắc #287); mỗi dòng có Xem/In/Sửa/Huỷ.
 */
export function StockRequestListPage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Yêu cầu cấp hàng' }]);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const multiBranch = showBranchInfo(user);
  const canCreate = useHasPermission('stock_request', 'create');
  const canApprove = useHasPermission('stock_request', 'approve');

  const [view, setView] = useState<View>('mine');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [status, setStatus] = useState<StockRequestStatus | ''>('');
  const [priority, setPriority] = useState<StockRequestPriority | ''>('');
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [cancelTarget, setCancelTarget] = useState<StockRequestSummary | null>(null);
  const [printing, setPrinting] = useState<StockRequestDetail | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  // Tab "Hàng cần bổ sung" (#298 mockup màn 4) tự tải dữ liệu riêng; danh sách bên dưới chỉ chạy cho hai tab phiếu.
  const listView = view === 'restock' ? 'mine' : view;
  const baseQuery: ListStockRequestsQuery = {
    view: listView,
    limit: PAGE_LIMIT,
    status: status || undefined,
    priority: priority || undefined,
    warehouseId: warehouseId || undefined,
    from: from || undefined,
    to: to || undefined,
    q: debouncedQ.trim() || undefined,
  };
  const listQuery = useStockRequestsQuery({ ...baseQuery, cursor: cursorStack[cursorStack.length - 1] }, view !== 'restock');
  const warehousesQuery = useWarehousesQuery();
  const pendingCounts = useStockRequestPendingCountsQuery(canApprove);
  const exportMutation = useExportStockRequestsMutation();

  const items = listQuery.data?.items ?? [];
  const statusCounts = listQuery.data?.statusCounts;
  const toAccept = pendingCounts.data?.toAccept ?? 0;
  const updated = pendingCounts.data?.updated ?? 0;

  function resetPaging() {
    setCursorStack([]);
  }

  function changeView(next: View) {
    setView(next);
    setStatus('');
    setWarehouseId('');
    resetPaging();
  }

  const gridColumns = multiBranch ? GRID_MULTI : GRID_SINGLE;
  const minWidth = multiBranch ? MIN_WIDTH_MULTI : MIN_WIDTH_SINGLE;

  const filterLabels = useMemo(() => {
    const labels: string[] = [];
    if (status) labels.push(`Trạng thái: ${REQUEST_STATUS_META[status].label}`);
    if (priority) labels.push(`Mức khẩn: ${REQUEST_PRIORITY_LABEL[priority]}`);
    if (warehouseId) labels.push(`Kho: ${warehousesQuery.data?.items.find((w) => w.id === warehouseId)?.name ?? ''}`);
    if (from || to) labels.push(`Ngày lập: ${from ? formatDayVn(from) : '...'} đến ${to ? formatDayVn(to) : '...'}`);
    return labels;
  }, [status, priority, warehouseId, from, to, warehousesQuery.data]);

  /** In danh sách: tải đủ mọi trang theo bộ lọc hiện tại (không chỉ phần đang xem) rồi dựng bản in. */
  async function loadPrintSpec(): Promise<ReportPrintSpec> {
    const { pages, capped } = await loadAllByCursor((cursor) => getStockRequests({ ...baseQuery, limit: PRINT_LOAD_PAGE_SIZE, cursor }), REPORT_PRINT_ROW_CAP);
    const all = pages.flatMap((p) => p.items).slice(0, REPORT_PRINT_ROW_CAP);
    const spec = buildStockRequestListPrintSpec(all, { view: listView, filterLabels, multiBranch });
    return capped ? { ...spec, note: `Chỉ in ${REPORT_PRINT_ROW_CAP.toLocaleString('vi-VN')} dòng đầu theo bộ lọc hiện tại.` } : spec;
  }

  /** In một phiếu từ hàng: tải chi tiết rồi mở hộp in (bản in cần đủ dòng hàng). */
  async function printRow(item: StockRequestSummary) {
    setPrintError(null);
    try {
      const detail = await getStockRequest(item.id);
      setPrinting(detail);
      setTimeout(() => {
        window.print();
        setPrinting(null);
      }, 150);
    } catch (err) {
      setPrintError(err instanceof ApiError ? err.message : 'Không tải được phiếu để in, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Yêu cầu cấp hàng</h1>

      {(canApprove || canCreate) && (
        <TabBar
          variant="underline"
          active={view}
          onChange={changeView}
          className="flex-shrink-0 px-1"
          tabs={[
            { id: 'mine', label: 'Của tôi' },
            ...(canApprove ? [{ id: 'incoming' as const, label: 'Cần duyệt', badge: toAccept + updated }] : []),
            ...(canCreate ? [{ id: 'restock' as const, label: 'Hàng cần bổ sung' }] : []),
          ]}
        />
      )}

      {view === 'restock' && <StockRequestRestockTab />}
      {view !== 'restock' && (
        <>

      <div className="flex flex-shrink-0 flex-wrap items-end justify-between gap-2.5 px-1">
        <div className="flex flex-wrap items-end gap-2.5">
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPaging();
            }}
            placeholder="Tìm theo số phiếu..."
            aria-label="Tìm theo số phiếu"
            className="w-52 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <Combobox
            id="request-filter-priority"
            value={priority}
            onChange={(v) => {
              setPriority(v as StockRequestPriority | '');
              resetPaging();
            }}
            options={[{ value: '', label: 'Mức khẩn: Tất cả' }, { value: 'URGENT', label: 'Khẩn' }, { value: 'NORMAL', label: 'Thường' }]}
          />
          <Combobox
            id="request-filter-warehouse"
            value={warehouseId}
            onChange={(v) => {
              setWarehouseId(v);
              resetPaging();
            }}
            options={[{ value: '', label: view === 'incoming' ? 'Kho xin: Tất cả' : 'Kho cấp: Tất cả' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]}
          />
          <div className="flex items-center gap-1.5">
            <DateInput id="request-filter-from" value={from} onChange={(v) => { setFrom(v); resetPaging(); }} dense />
            <span className="text-sm text-slate-500">đến</span>
            <DateInput id="request-filter-to" value={to} onChange={(v) => { setTo(v); resetPaging(); }} dense />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" loading={exportMutation.isPending} onClick={() => exportMutation.mutate({ ...baseQuery, limit: PAGE_LIMIT })}>
            <DownloadSimple size={16} weight="bold" aria-hidden="true" />
            Xuất Excel
          </Button>
          <ReportPrintAction loadSpec={loadPrintSpec} label="In danh sách" />
          {canCreate && view === 'mine' && (
            <Button type="button" onClick={() => navigate('/inventory/requests/new')}>
              <Plus size={16} weight="bold" aria-hidden="true" />
              Tạo yêu cầu
            </Button>
          )}
        </div>
      </div>

      {statusCounts && (
        <div className="flex flex-shrink-0 flex-wrap gap-2 px-1" role="group" aria-label="Lọc theo trạng thái">
          {REQUEST_STATUS_ORDER.filter((s) => view === 'mine' || s !== 'DRAFT').map((s) => {
            const active = status === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setStatus(active ? '' : s);
                  resetPaging();
                }}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${active ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'}`}
              >
                {REQUEST_STATUS_META[s].label}
                <span className="tabular-nums text-slate-900">{statusCounts[s] ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}

      {view === 'incoming' && toAccept > 0 && (
        <div role="status" className="flex-shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Có <strong>{toAccept} phiếu</strong> đang chờ kho của chi nhánh này tiếp nhận{updated > 0 ? `, ${updated} phiếu bên xin vừa cập nhật` : ''}.
        </div>
      )}

      {printError && <ErrorBanner message={printError} onRetry={() => setPrintError(null)} />}
      {listQuery.isError && (
        <ErrorBanner message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách yêu cầu cấp hàng.'} onRetry={() => void listQuery.refetch()} />
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
          icon={ClipboardText}
          title={view === 'incoming' ? 'Chưa có yêu cầu nào gửi tới kho của chi nhánh này' : 'Chưa có yêu cầu cấp hàng nào'}
          description={view === 'incoming' ? 'Phiếu hiện ở đây từ lúc bên xin bấm Gửi.' : 'Tạo yêu cầu để xin hàng từ kho cấp trên.'}
        />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách phiếu yêu cầu cấp hàng" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth }}>
              <div role="row" style={{ gridTemplateColumns: gridColumns }} className="grid flex-shrink-0 gap-x-3 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-center">Số phiếu</div>
                <div role="columnheader" className="py-2.5 text-left">{multiBranch ? 'Kho xin (chi nhánh)' : 'Kho xin'}</div>
                <div role="columnheader" className="py-2.5 text-left">{multiBranch ? 'Kho cấp (chi nhánh)' : 'Kho cấp'}</div>
                <div role="columnheader" className="py-2.5 text-center">Khẩn</div>
                <div role="columnheader" className="py-2.5 text-center">Ngày cần</div>
                <div role="columnheader" className="py-2.5 text-center">Số dòng</div>
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-left">Người lập</div>
                <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => {
                  const meta = REQUEST_STATUS_META[item.status];
                  const actions = requesterActionsFor(item.status);
                  const mine = view === 'mine';
                  const needsAttention = !mine && (item.status === 'SUBMITTED' || item.supplierUpdatePending || item.readyToSupply);
                  return (
                    <div
                      key={item.id}
                      role="row"
                      style={{ gridTemplateColumns: gridColumns, minHeight: ROW_HEIGHT_PX }}
                      className={`grid items-center gap-x-3 border-b border-slate-100 px-4 text-sm hover:bg-slate-50 ${needsAttention ? 'bg-amber-50/50 hover:bg-amber-50' : ''} ${['REJECTED', 'CANCELLED', 'WITHDRAWN'].includes(item.status) ? 'opacity-70' : ''}`}
                    >
                      <div role="cell" className="min-w-0 text-center">
                        <p className="truncate font-semibold text-slate-800">{item.requestNo}</p>
                        <p className="text-xs font-medium text-slate-500">{formatDateShort(item.createdAt)}</p>
                      </div>
                      <div role="cell" className="min-w-0 text-left">
                        <p className="truncate font-semibold text-slate-900" title={item.requestingWarehouseName}>{item.requestingWarehouseName}</p>
                        {multiBranch && <p className="truncate text-xs font-medium text-slate-500">{item.requestingBranchName}</p>}
                      </div>
                      <div role="cell" className="min-w-0 text-left">
                        <p className="truncate font-semibold text-slate-900" title={item.supplyingWarehouseName}>{item.supplyingWarehouseName}</p>
                        {multiBranch && <p className="truncate text-xs font-medium text-slate-500">{item.supplyingBranchName}</p>}
                      </div>
                      <div role="cell" className="text-center">
                        {item.priority === 'URGENT' ? <StatusBadge tone="danger">Khẩn</StatusBadge> : <span className="font-medium text-slate-500">Thường</span>}
                      </div>
                      <div role="cell" className="text-center font-medium text-slate-600">{item.neededBy ? formatDayVn(item.neededBy) : '—'}</div>
                      <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{item.lineCount}</div>
                      <div role="cell" className="flex flex-col items-center gap-0.5">
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        {item.readyToSupply && <StatusBadge tone="success">Hàng đã về</StatusBadge>}
                        {!mine && item.supplierUpdatePending && <StatusBadge tone="warning">Có cập nhật mới</StatusBadge>}
                        {item.parentRequestNo && <span className="text-[11px] font-medium text-slate-500">Xin phần thiếu của {item.parentRequestNo}</span>}
                      </div>
                      <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-600">{item.createdByName}</div>
                      <div role="cell" className="flex items-center justify-center gap-1.5">
                        <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => navigate(`/inventory/requests/${item.id}`)} />
                        <PrintButton
                          documentType="STOCK_REQUEST"
                          onPrint={() => void printRow(item)}
                          renderTrigger={({ onClick, disabled }) => <RowActionButton icon={Printer} label="In phiếu" tone="neutral" onClick={onClick} disabled={disabled} />}
                        />
                        {mine && canCreate && actions.edit && <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => navigate(`/inventory/requests/${item.id}/edit`)} />}
                        {mine && canCreate && actions.cancel && <RowActionButton icon={X} label="Huỷ phiếu" tone="danger" onClick={() => setCancelTarget(item)} />}
                        {mine && canCreate && actions.addLines && !actions.edit && (
                          <RowActionButton icon={Plus} label="Thêm hàng" tone="primary" onClick={() => navigate(`/inventory/requests/${item.id}?thao-tac=them-hang`)} />
                        )}
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

        </>
      )}

      {cancelTarget && <CancelDialog target={cancelTarget} onClose={() => setCancelTarget(null)} />}
      {printing && <StockRequestPrintView request={printing} />}
    </div>
  );
}

function CancelDialog({ target, onClose }: { target: StockRequestSummary; onClose: () => void }) {
  const mutation = useCancelStockRequestMutation();
  return (
    <ReasonConfirmDialog
      title="Huỷ phiếu yêu cầu cấp hàng"
      rows={[{ label: 'Phiếu', value: target.requestNo }]}
      note="Kho cấp chưa tiếp nhận nên huỷ được."
      confirmLabel="Xác nhận huỷ"
      confirmVariant="danger"
      onConfirm={(reason) => mutation.mutateAsync({ id: target.id, body: { reason, version: target.version } })}
      onDone={onClose}
      onClose={onClose}
    />
  );
}
