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
import { useAcceptStockRequestMutation, useCancelStockRequestMutation, useExportStockRequestsMutation, useStockRequestPendingCountsQuery, useStockRequestsQuery } from './stock-request.queries';
import { formatDayVn, REQUEST_PRIORITY_LABEL, REQUEST_STATUS_META, requesterActionsFor } from './stock-request-meta';
import { StockRequestPrintView } from './StockRequestPrintView';
import { StockRequestRestockTab } from './StockRequestRestockTab';

type View = 'mine' | 'incoming' | 'restock';

const ROW_HEIGHT_PX = 58;
const PAGE_LIMIT = 50;
// Cột đúng mockup màn 2: tab "Yêu cầu của tôi" 7 cột, tab "Cần duyệt" 7 cột; co giãn (minmax + fr) để vừa màn 1280px (`ui-guidelines.md` mục 14/15).
const GRID_MINE = '120px minmax(220px,1.4fr) 90px 110px minmax(160px,1fr) 140px 210px';
const MIN_WIDTH_MINE = 1160;
const GRID_INCOMING = '120px minmax(160px,1fr) minmax(170px,1fr) 90px 110px 140px minmax(220px,1fr)';
const MIN_WIDTH_INCOMING = 1180;

/** Năm ô đếm của mockup (dải đếm theo trạng thái), mỗi ô cũng là nút lọc theo trạng thái đó. */
const STRIP_STATUSES: StockRequestStatus[] = ['SUBMITTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'];
const STRIP_VALUE_CLASS: Record<string, string> = {
  SUBMITTED: 'text-amber-700',
  ACCEPTED: 'text-slate-900',
  IN_PROGRESS: 'text-blue-600',
  COMPLETED: 'text-emerald-600',
  REJECTED: 'text-rose-600',
};
/** Trạng thái còn lại không có ô trong dải của mockup nhưng vẫn lọc được: chip nhỏ chỉ hiện khi có phiếu. */
const EXTRA_STATUSES: StockRequestStatus[] = ['DRAFT', 'CANCELLED', 'WITHDRAWN'];

function formatDateShort(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/** "12-11-2026 09:12" theo giờ Việt Nam — dòng phụ "Gửi …" của cột Kho xin → Kho cấp. */
function formatDateTimeShort(iso: string): string {
  const vn = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${formatDateShort(iso)} ${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
}

/** Nối các vế thông báo kiểu "A, B và C" (mockup màn 2, dải thông báo tab Cần duyệt). */
function joinParts(parts: React.ReactNode[]): React.ReactNode[] {
  return parts.flatMap((part, index) => {
    const separator = index === 0 ? '' : index === parts.length - 1 ? ' và ' : ', ';
    return separator ? [separator, part] : [part];
  });
}

/**
 * "Yêu cầu cấp hàng" (docs/DECISIONS.md #298, mockup màn 2 đã duyệt). Hai tab: "Yêu cầu của tôi" (phiếu của kho thuộc chi nhánh đang làm) và "Cần duyệt" (phiếu xin kho của chi nhánh này,
 * từ lúc đã gửi — chỉ người có quyền duyệt thấy). Dải đếm theo trạng thái, lọc ngày/kho/mức khẩn, Xuất Excel và In danh sách (quy tắc #287); tab "Yêu cầu của tôi" có cột "Tiến độ cấp"
 * và các nút Xem/In/Sửa/Huỷ/Thêm hàng, tab "Cần duyệt" có cột "Người xin" và "Việc cần làm" (Tiếp nhận/Cấp tiếp/Xử lý).
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
  const [actionError, setActionError] = useState<string | null>(null);

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
  const acceptMutation = useAcceptStockRequestMutation();

  const items = listQuery.data?.items ?? [];
  const statusCounts = listQuery.data?.statusCounts;
  const toAccept = pendingCounts.data?.toAccept ?? 0;
  const updated = pendingCounts.data?.updated ?? 0;
  const ready = pendingCounts.data?.ready ?? 0;
  const actionable = pendingCounts.data?.actionable ?? 0;

  function resetPaging() {
    setCursorStack([]);
  }

  function changeView(next: View) {
    setView(next);
    setStatus('');
    setWarehouseId('');
    setActionError(null);
    resetPaging();
  }

  const incoming = view === 'incoming';
  const gridColumns = incoming ? GRID_INCOMING : GRID_MINE;
  const minWidth = incoming ? MIN_WIDTH_INCOMING : MIN_WIDTH_MINE;

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

  /** Nút "Tiếp nhận" ngay ở hàng (mockup màn 2): nhận việc rồi giữ nguyên danh sách; lỗi (người khác vừa xử lý, hết quyền) hiện tại chỗ. */
  async function acceptRow(item: StockRequestSummary) {
    setActionError(null);
    try {
      await acceptMutation.mutateAsync({ id: item.id, body: { version: item.version } });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Không tiếp nhận được phiếu, vui lòng thử lại.');
    }
  }

  const waitingItems = !incoming ? items.filter((i) => i.waitingLineCount > 0 && (i.status === 'ACCEPTED' || i.status === 'IN_PROGRESS')) : [];
  const extraStatuses = statusCounts ? EXTRA_STATUSES.filter((s) => (statusCounts[s] ?? 0) > 0 && (s !== 'DRAFT' || !incoming)) : [];

  function toggleStatus(s: StockRequestStatus) {
    setStatus(status === s ? '' : s);
    resetPaging();
  }

  /** Tên kho kèm chi nhánh khi công ty có từ 2 chi nhánh. */
  function warehouseLabel(name: string, branchName: string): string {
    return multiBranch ? `${name} (${branchName})` : name;
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
            { id: 'mine', label: 'Yêu cầu của tôi' },
            ...(canApprove ? [{ id: 'incoming' as const, label: 'Cần duyệt', badge: actionable }] : []),
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
            placeholder="Tìm theo số phiếu, mặt hàng..."
            aria-label="Tìm theo số phiếu, mặt hàng"
            className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <div className="flex items-center gap-1.5">
            <DateInput id="request-filter-from" value={from} onChange={(v) => { setFrom(v); resetPaging(); }} dense />
            <span className="text-sm text-slate-500">đến</span>
            <DateInput id="request-filter-to" value={to} onChange={(v) => { setTo(v); resetPaging(); }} dense />
          </div>
          <Combobox
            id="request-filter-warehouse"
            value={warehouseId}
            onChange={(v) => {
              setWarehouseId(v);
              resetPaging();
            }}
            options={[{ value: '', label: 'Kho xin: Tất cả' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]}
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
              Tạo yêu cầu cấp hàng
            </Button>
          )}
        </div>
      </div>

      {statusCounts && (
        <div className="flex-shrink-0 px-1">
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-5" role="group" aria-label="Lọc theo trạng thái">
            {STRIP_STATUSES.map((s, index) => {
              const active = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleStatus(s)}
                  className={`px-3.5 py-2 text-left ${index > 0 ? 'sm:border-l sm:border-slate-200' : ''} ${active ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : 'hover:bg-slate-50'}`}
                >
                  <span className="block text-[13px] font-medium text-slate-600">{REQUEST_STATUS_META[s].label}</span>
                  <span className={`text-xl font-semibold tabular-nums ${STRIP_VALUE_CLASS[s]}`}>{statusCounts[s] ?? 0}</span>
                </button>
              );
            })}
          </div>
          {extraStatuses.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2" role="group" aria-label="Lọc theo trạng thái khác">
              {extraStatuses.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={status === s}
                  onClick={() => toggleStatus(s)}
                  className={`rounded-md px-2.5 py-1 text-[13px] font-semibold ring-1 ring-inset ${status === s ? 'bg-blue-50 text-blue-700 ring-blue-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
                >
                  {REQUEST_STATUS_META[s].label} <span className="tabular-nums text-slate-900">{statusCounts[s] ?? 0}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {incoming && (toAccept > 0 || ready > 0 || updated > 0) && (
        <div role="status" className="flex-shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Có{' '}
          {joinParts([
            ...(toAccept > 0 ? [<b key="a">{toAccept} yêu cầu đang chờ tiếp nhận</b>] : []),
            ...(ready > 0 ? [<span key="r"><b>{ready} yêu cầu có hàng đã về</b> có thể cấp tiếp</span>] : []),
            ...(updated > 0 ? [<span key="u"><b>{updated} yêu cầu bên xin vừa cập nhật</b> (thêm mặt hàng)</span>] : []),
          ])}
          .
        </div>
      )}

      {waitingItems.length > 0 && (
        <div role="status" className="flex-shrink-0 space-y-0.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {waitingItems.slice(0, 3).map((i) => (
            <p key={i.id}>
              Phiếu <b>{i.requestNo}</b> có {i.waitingLineCount} dòng đang <b>chờ hàng về</b>
              {i.earliestWaitDate ? ` (dự kiến ${formatDayVn(i.earliestWaitDate)})` : ''}.{i.pendingLineCount === 0 ? ' Phần còn lại đã được cấp.' : ''}
            </p>
          ))}
          {waitingItems.length > 3 && <p>Và {waitingItems.length - 3} phiếu khác cũng đang chờ hàng về.</p>}
        </div>
      )}

      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />}
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
          title={incoming ? 'Chưa có yêu cầu nào gửi tới kho của chi nhánh này' : 'Chưa có yêu cầu cấp hàng nào'}
          description={incoming ? 'Phiếu hiện ở đây từ lúc bên xin bấm Gửi.' : 'Tạo yêu cầu để xin hàng từ kho cấp trên.'}
        />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách phiếu yêu cầu cấp hàng" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth }}>
              <div role="row" style={{ gridTemplateColumns: gridColumns }} className="grid flex-shrink-0 gap-x-3 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-center">Số phiếu</div>
                {incoming ? (
                  <>
                    <div role="columnheader" className="py-2.5 text-left">Từ chi nhánh / kho</div>
                    <div role="columnheader" className="py-2.5 text-left">Người xin</div>
                  </>
                ) : (
                  <div role="columnheader" className="py-2.5 text-left">Kho xin → Kho cấp</div>
                )}
                <div role="columnheader" className="py-2.5 text-center">Mức khẩn</div>
                <div role="columnheader" className="py-2.5 text-center">Cần hàng ngày</div>
                {!incoming && <div role="columnheader" className="py-2.5 text-left">Tiến độ cấp</div>}
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-center">{incoming ? 'Việc cần làm' : 'Thao tác'}</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => {
                  const meta = REQUEST_STATUS_META[item.status];
                  const actions = requesterActionsFor(item.status);
                  const needsAttention = incoming && (item.status === 'SUBMITTED' || item.supplierUpdatePending || item.readyToSupply);
                  const isDraft = item.status === 'DRAFT';
                  const hasProgressBar = item.status === 'ACCEPTED' || item.status === 'IN_PROGRESS' || item.status === 'COMPLETED';
                  const progressPct = item.activeLineCount > 0 ? Math.round((item.allocatedLineCount / item.activeLineCount) * 100) : 0;
                  const subLine = item.status === 'REJECTED' && item.rejectionReason
                    ? { tone: 'text-rose-600', text: `Từ chối: ${item.rejectionReason}` }
                    : item.status === 'CANCELLED' && item.cancellationReason
                      ? { tone: 'text-slate-500', text: `Đã huỷ: ${item.cancellationReason}` }
                      : item.submittedAt
                        ? { tone: 'text-slate-500', text: `Gửi ${formatDateTimeShort(item.submittedAt)}` }
                        : null;
                  const printAction = (
                    <PrintButton
                      documentType="STOCK_REQUEST"
                      onPrint={() => void printRow(item)}
                      renderTrigger={({ onClick, disabled }) => <RowActionButton icon={Printer} label="In phiếu" tone="neutral" onClick={onClick} disabled={disabled} />}
                    />
                  );
                  return (
                    <div
                      key={item.id}
                      role="row"
                      style={{ gridTemplateColumns: gridColumns, minHeight: ROW_HEIGHT_PX }}
                      className={`grid items-center gap-x-3 border-b border-slate-100 px-4 text-sm hover:bg-slate-50 ${needsAttention ? 'bg-amber-50/50 hover:bg-amber-50' : ''} ${['REJECTED', 'CANCELLED', 'WITHDRAWN'].includes(item.status) ? 'opacity-70' : ''}`}
                    >
                      <div role="cell" className="min-w-0 text-center">
                        <p className="truncate font-semibold text-slate-800" title={isDraft ? item.requestNo : undefined}>{isDraft && !incoming ? 'Nháp' : item.requestNo}</p>
                      </div>

                      {incoming ? (
                        <>
                          <div role="cell" className="min-w-0 text-left">
                            <p className="truncate font-semibold text-slate-900" title={item.requestingBranchName}>{item.requestingBranchName}</p>
                            <p className="truncate text-xs font-medium text-slate-500" title={item.requestingWarehouseName}>{item.requestingWarehouseName}</p>
                          </div>
                          <div role="cell" className="min-w-0 text-left">
                            <p className="truncate font-semibold text-slate-900" title={item.createdByName}>{item.createdByName}</p>
                            {item.requestingDepartmentName && <p className="truncate text-xs font-medium text-slate-500" title={item.requestingDepartmentName}>{item.requestingDepartmentName}</p>}
                          </div>
                        </>
                      ) : (
                        <div role="cell" className="min-w-0 text-left">
                          <p className="truncate text-slate-900" title={`${warehouseLabel(item.requestingWarehouseName, item.requestingBranchName)} → ${warehouseLabel(item.supplyingWarehouseName, item.supplyingBranchName)}`}>
                            <strong className="font-semibold">{warehouseLabel(item.requestingWarehouseName, item.requestingBranchName)}</strong> → {warehouseLabel(item.supplyingWarehouseName, item.supplyingBranchName)}
                          </p>
                          {subLine && <p className={`truncate text-xs font-medium ${subLine.tone}`} title={subLine.text}>{subLine.text}</p>}
                        </div>
                      )}

                      <div role="cell" className="text-center">
                        {item.priority === 'URGENT' ? <StatusBadge tone="danger">Khẩn</StatusBadge> : <StatusBadge tone="neutral">Thường</StatusBadge>}
                      </div>
                      <div role="cell" className="text-center font-medium text-slate-600">{item.neededBy ? formatDayVn(item.neededBy) : '—'}</div>

                      {!incoming && (
                        <div role="cell" className="min-w-0 text-left font-medium text-slate-800">
                          {isDraft ? (
                            `${item.lineCount} dòng`
                          ) : item.status === 'SUBMITTED' ? (
                            'Chưa ai nhận'
                          ) : item.activeLineCount === 0 ? (
                            '—'
                          ) : (
                            <>
                              <span className="tabular-nums">{item.allocatedLineCount} / {item.activeLineCount} dòng đã cấp</span>
                              {hasProgressBar && (
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct} aria-label="Tiến độ cấp">
                                  <div className="h-full bg-emerald-500" style={{ width: `${progressPct}%` }} />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      <div role="cell" className="flex flex-col items-center gap-0.5">
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        {incoming && item.readyToSupply && <StatusBadge tone="success">Hàng đã về</StatusBadge>}
                        {incoming && item.supplierUpdatePending && <StatusBadge tone="warning">Có cập nhật mới</StatusBadge>}
                        {item.parentRequestNo && <span className="text-[11px] font-medium text-slate-500">Xin phần thiếu của {item.parentRequestNo}</span>}
                      </div>

                      {incoming ? (
                        <div role="cell" className="flex items-center justify-center gap-1.5">
                          {item.status === 'SUBMITTED' ? (
                            <Button type="button" className="!px-3 !py-1 !text-xs" loading={acceptMutation.isPending && acceptMutation.variables?.id === item.id} onClick={() => void acceptRow(item)}>
                              Tiếp nhận
                            </Button>
                          ) : item.readyToSupply ? (
                            <Button type="button" className="!px-3 !py-1 !text-xs" onClick={() => navigate(`/inventory/requests/${item.id}`)}>
                              Cấp tiếp
                            </Button>
                          ) : item.supplierUpdatePending ? (
                            <Button type="button" className="!px-3 !py-1 !text-xs" onClick={() => navigate(`/inventory/requests/${item.id}`)}>
                              Xử lý
                            </Button>
                          ) : (
                            <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => navigate(`/inventory/requests/${item.id}`)} />
                          )}
                          {printAction}
                        </div>
                      ) : (
                        <div role="cell" className="flex items-center justify-center gap-1.5">
                          {!isDraft && <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => navigate(`/inventory/requests/${item.id}`)} />}
                          {!isDraft && printAction}
                          {canCreate && actions.edit && <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => navigate(`/inventory/requests/${item.id}/edit`)} />}
                          {canCreate && actions.cancel && !isDraft && <RowActionButton icon={X} label="Huỷ phiếu" tone="danger" onClick={() => setCancelTarget(item)} />}
                          {canCreate && actions.addLines && !actions.edit && (
                            <RowActionButton icon={Plus} label="Thêm hàng" tone="primary" onClick={() => navigate(`/inventory/requests/${item.id}?thao-tac=them-hang`)} />
                          )}
                        </div>
                      )}
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
