import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, PencilSimple, Plus, Truck, X } from '@phosphor-icons/react';
import type { StockTransferStatus, StockTransferSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { TabBar } from '../../shared/ui/TabBar';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { showBranchInfo } from '../branch/branch-visibility';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { useStockTransferPendingCountsQuery, useStockTransfersQuery } from './inventory.queries';
import { StockTransferRejectDialog } from './StockTransferRejectDialog';
import { nextTransferAction, TRANSFER_ACTION_LABEL, TRANSFER_STATUS_META, TRANSFER_STATUS_ORDER, varianceOverdueDays } from './stock-transfer-meta';

type Direction = 'out' | 'in';

const ROW_HEIGHT_PX = 60;
const PAGE_LIMIT = 50;

/** Cột theo từng chế độ xem — "Phiếu đi" (mặc định, gồm cả điều chuyển cùng chi nhánh) và "Phiếu đến" (từ chi nhánh khác). Mockup Đợt 2 màn 4. */
// Cột co giãn (minmax + fr) thay cho px cứng: tổng tối thiểu ~890px nên vừa màn 1280px (laptop, 24 inch phóng 125%); màn rộng thì các cột dãn ra. Kiểm toàn app 16/10/2026.
const GRID_OUT_SINGLE = '110px minmax(150px,1.1fr) minmax(170px,1fr) 100px 70px 120px minmax(150px,0.9fr)';
const GRID_OUT_MULTI = '110px minmax(170px,1.3fr) minmax(170px,1fr) 100px 70px 120px minmax(150px,0.9fr)';
const GRID_IN = '110px minmax(150px,1fr) minmax(130px,0.9fr) minmax(170px,1.1fr) 100px 70px minmax(140px,0.9fr)';
const MIN_WIDTH_OUT = 1250;
const MIN_WIDTH_IN = 1220;

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/**
 * "Điều chuyển kho" — Kho Thuốc GĐ4 (docs/DECISIONS.md #170) + Đợt 2 chi nhánh (#233, mockup màn 4 đã duyệt). Công ty có từ 2 chi nhánh chia
 * 2 tab: "Phiếu đi" (kho gửi thuộc chi nhánh đang làm) và "Phiếu đến" (phiếu từ chi nhánh KHÁC, chỉ từ lúc Duyệt xuất). Công ty 1 chi nhánh: không
 * tab, không cột chi nhánh — giao diện như trước. Mỗi dòng có nút việc cần làm theo vai trò (Xác nhận nhận hàng / Xử lý chênh lệch / Xác nhận đã
 * nhận lại hàng) dẫn sang `StockTransferFormPage` ở đúng chế độ theo trạng thái phiếu.
 */
export function StockTransferListPage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Điều chuyển kho' }]);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const multiBranch = showBranchInfo(user);
  const currentBranchId = user?.currentBranchId ?? null;
  const canCreate = useHasPermission('stock_transfer', 'create');
  const canApprove = useHasPermission('stock_transfer', 'approve');

  const [direction, setDirection] = useState<Direction>('out');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState<StockTransferStatus | ''>('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [rejectTarget, setRejectTarget] = useState<StockTransferSummary | null>(null);

  const cursor = cursorStack[cursorStack.length - 1];
  const listQuery = useStockTransfersQuery({
    cursor,
    limit: PAGE_LIMIT,
    // Tab "Phiếu đi": lọc theo kho gửi; tab "Phiếu đến": lọc theo kho nhận (kho gửi thuộc chi nhánh khác nên không có danh sách để lọc).
    fromWarehouseId: direction === 'out' ? warehouseId || undefined : undefined,
    toWarehouseId: direction === 'in' ? warehouseId || undefined : undefined,
    status: status || undefined,
    q: debouncedQ.trim() || undefined,
    direction,
  });
  const warehousesQuery = useWarehousesQuery();
  const pendingCounts = useStockTransferPendingCountsQuery();

  const items = listQuery.data?.items ?? [];
  const incomingCount = pendingCounts.data?.incoming ?? 0;
  const toResolveCount = pendingCounts.data?.toResolve ?? 0;

  function changeDirection(next: Direction) {
    setDirection(next);
    setWarehouseId('');
    setStatus('');
    setCursorStack([]);
  }

  const gridColumns = direction === 'in' ? GRID_IN : multiBranch ? GRID_OUT_MULTI : GRID_OUT_SINGLE;
  const minWidth = direction === 'in' ? MIN_WIDTH_IN : MIN_WIDTH_OUT;

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Điều chuyển kho</h1>

      {multiBranch && (
        <TabBar
          variant="underline"
          active={direction}
          onChange={changeDirection}
          className="flex-shrink-0 px-1"
          tabs={[
            { id: 'out', label: 'Phiếu đi', badge: toResolveCount },
            { id: 'in', label: 'Phiếu đến', badge: incomingCount },
          ]}
        />
      )}

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2.5 px-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursorStack([]);
            }}
            placeholder="Tìm theo số phiếu..."
            className="w-60 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <Combobox
            id="transfer-filter-warehouse"
            value={warehouseId}
            onChange={(v) => {
              setWarehouseId(v);
              setCursorStack([]);
            }}
            options={[{ value: '', label: direction === 'in' ? 'Kho nhận: Tất cả' : 'Kho gửi: Tất cả' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]}
          />
          <Combobox
            id="transfer-filter-status"
            value={status}
            onChange={(v) => {
              setStatus(v as StockTransferStatus | '');
              setCursorStack([]);
            }}
            options={[{ value: '', label: 'Trạng thái: Tất cả' }, ...TRANSFER_STATUS_ORDER.map((s) => ({ value: s, label: TRANSFER_STATUS_META[s].label }))]}
          />
        </div>
        {canCreate && (
          <Button type="button" onClick={() => navigate('/inventory/transfers/new')}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Tạo phiếu điều chuyển
          </Button>
        )}
      </div>

      {direction === 'in' && incomingCount > 0 && (
        <div role="status" className="flex-shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Có <strong>{incomingCount} phiếu đang đến</strong> chi nhánh này đang chờ xác nhận nhận hàng.
        </div>
      )}
      {direction === 'out' && toResolveCount > 0 && (
        <div role="status" className="flex-shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Có <strong>{toResolveCount} phiếu</strong> đang chờ chi nhánh này xử lý (nhận có chênh lệch hoặc bị từ chối nhận, cần xác nhận nhận lại hàng).
        </div>
      )}

      {listQuery.isError && (
        <ErrorBanner message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách phiếu điều chuyển kho.'} onRetry={() => void listQuery.refetch()} />
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
          icon={Truck}
          title={direction === 'in' ? 'Chưa có phiếu nào đang đến chi nhánh này' : 'Chưa có phiếu điều chuyển kho nào'}
          description={direction === 'in' ? 'Phiếu từ chi nhánh khác hiện ở đây từ lúc bên gửi Duyệt xuất.' : 'Tạo phiếu để chuyển hàng giữa các kho.'}
        />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách phiếu điều chuyển kho" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth }}>
              <div role="row" style={{ gridTemplateColumns: gridColumns }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-center">Số phiếu</div>
                {direction === 'in' ? (
                  <>
                    <div role="columnheader" className="py-2.5 text-left">Từ chi nhánh / kho</div>
                    <div role="columnheader" className="py-2.5 text-left">Đến kho</div>
                  </>
                ) : (
                  <div role="columnheader" className="py-2.5 text-center">{multiBranch ? 'Kho nguồn → Đến chi nhánh / kho' : 'Kho nguồn → Kho đích'}</div>
                )}
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-center">Ngày chuyển</div>
                <div role="columnheader" className="py-2.5 text-center">Số dòng</div>
                {direction === 'out' && <div role="columnheader" className="py-2.5 text-left">Người tạo</div>}
                <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => {
                  const action = canApprove ? nextTransferAction(item, currentBranchId) : null;
                  const needsAction = action !== null;
                  const meta = TRANSFER_STATUS_META[item.status];
                  const overdueDays = varianceOverdueDays(item, Date.now());
                  const sameBranch = item.fromBranchId === item.toBranchId;
                  return (
                    <div
                      key={item.id}
                      role="row"
                      style={{ gridTemplateColumns: gridColumns, minHeight: ROW_HEIGHT_PX }}
                      className={`grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50 ${needsAction ? 'bg-amber-50/50 hover:bg-amber-50' : ''} ${item.status === 'REJECTED' ? 'opacity-70' : ''}`}
                    >
                      <div role="cell" className={`truncate text-center font-semibold ${item.status === 'REJECTED' ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                        {item.transferNo}
                      </div>

                      {direction === 'in' ? (
                        <>
                          <div role="cell" className="min-w-0 text-left">
                            <p className="truncate font-semibold text-slate-900" title={item.fromBranchName}>{item.fromBranchName}</p>
                            <p className="truncate text-xs font-medium text-slate-500" title={item.fromWarehouseName}>{item.fromWarehouseName}</p>
                          </div>
                          <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-900" title={item.toWarehouseName}>{item.toWarehouseName}</div>
                        </>
                      ) : (
                        <div role="cell" className="flex min-w-0 items-center justify-center gap-1.5 font-medium text-slate-900">
                          <span className="min-w-0 truncate" title={item.fromWarehouseName}>{item.fromWarehouseName}</span>
                          <ArrowRight size={13} className="flex-shrink-0 text-slate-400" aria-hidden="true" />
                          {multiBranch && !sameBranch ? (
                            <span className="min-w-0 truncate" title={`${item.toBranchName} / ${item.toWarehouseName}`}>
                              <strong>{item.toBranchName}</strong> / {item.toWarehouseName}
                            </span>
                          ) : (
                            <span className="min-w-0 truncate" title={item.toWarehouseName}>
                              {item.toWarehouseName}
                              {multiBranch && <span className="ml-1 text-xs text-slate-400">(cùng chi nhánh)</span>}
                            </span>
                          )}
                        </div>
                      )}

                      <div role="cell" className="flex flex-col items-center gap-0.5">
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        {overdueDays !== null && <StatusBadge tone="danger">Quá hạn xử lý · {overdueDays} ngày</StatusBadge>}
                      </div>
                      <div role="cell" className="text-center font-medium text-slate-600">{item.shippedAt ? formatDateShort(item.shippedAt) : item.status === 'DRAFT' ? '—' : formatDateShort(item.occurredAt)}</div>
                      <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{item.lineCount}</div>
                      {direction === 'out' && <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-600">{item.createdByName}</div>}

                      <div role="cell" className="flex items-center justify-center gap-1.5">
                        <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => navigate(`/inventory/transfers/${item.id}`)} />
                        {item.status === 'DRAFT' && (
                          <>
                            {canCreate && <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => navigate(`/inventory/transfers/${item.id}`)} />}
                            {canApprove && <RowActionButton icon={X} label="Từ chối" tone="danger" onClick={() => setRejectTarget(item)} />}
                          </>
                        )}
                        {action && (
                          <button
                            type="button"
                            onClick={() => navigate(`/inventory/transfers/${item.id}`)}
                            className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            <Truck size={13} weight="bold" aria-hidden="true" />
                            {TRANSFER_ACTION_LABEL[action]}
                          </button>
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

      {rejectTarget && (
        <StockTransferRejectDialog
          transferId={rejectTarget.id}
          transferNo={rejectTarget.transferNo}
          version={rejectTarget.version}
          onDone={() => setRejectTarget(null)}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </div>
  );
}

// (RowActionButton "Duyệt xuất" cố ý KHÔNG đặt ở danh sách — Duyệt xuất cần xem lại đủ dòng hàng
// trước khi xác nhận, đúng khuôn "Sửa"/"Xem" điều hướng sang `StockTransferFormPage`, không có
// nút Duyệt trực-tiếp-trong-hàng như `stock_receipt`/`stock_count` — mockup đã chốt vậy vì Điều
// chuyển còn thêm khái niệm "kiểm đủ tồn kho nguồn" nên cần trang riêng để thấy rõ trước khi Duyệt.)
