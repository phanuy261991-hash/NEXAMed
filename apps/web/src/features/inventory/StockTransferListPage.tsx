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
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useHasPermission } from '../auth/usePermission';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { useStockTransfersQuery } from './inventory.queries';
import { StockTransferRejectDialog } from './StockTransferRejectDialog';

const GRID_COLUMNS = '130px 280px 160px 110px 90px 150px 210px';
const TABLE_MIN_WIDTH_PX = 1130;
const ROW_HEIGHT_PX = 56;
const PAGE_LIMIT = 50;

const STATUS_META: Record<StockTransferStatus, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  IN_TRANSIT: { label: 'Đang vận chuyển', tone: 'warning' },
  COMPLETED: { label: 'Hoàn tất', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/**
 * "Điều chuyển kho" — Kho Thuốc GĐ4 (docs/DECISIONS.md #170, mockup đã duyệt). List Screen Pattern
 * đúng khuôn `StockReceiptListPage.tsx`/`StockCountListPage.tsx` — nhưng phiếu "Đang vận chuyển" tô
 * nền vàng nhạt + nút nổi bật "Xác nhận nhận hàng" (điều hướng sang `StockTransferFormPage` ở chế độ
 * Xác nhận nhận hàng, theo đúng trạng thái phiếu) để dễ nhận ra việc cần xử lý.
 */
export function StockTransferListPage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Điều chuyển kho' }]);
  const navigate = useNavigate();
  const canCreate = useHasPermission('stock_transfer', 'create');
  const canApprove = useHasPermission('stock_transfer', 'approve');

  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [status, setStatus] = useState<StockTransferStatus | ''>('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [rejectTarget, setRejectTarget] = useState<StockTransferSummary | null>(null);

  const cursor = cursorStack[cursorStack.length - 1];
  const listQuery = useStockTransfersQuery({
    cursor,
    limit: PAGE_LIMIT,
    fromWarehouseId: fromWarehouseId || undefined,
    toWarehouseId: toWarehouseId || undefined,
    status: status || undefined,
    q: debouncedQ.trim() || undefined,
  });
  const warehousesQuery = useWarehousesQuery();

  const items = listQuery.data?.items ?? [];

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Điều chuyển kho</h1>

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
            id="transfer-filter-from"
            value={fromWarehouseId}
            onChange={(v) => {
              setFromWarehouseId(v);
              setCursorStack([]);
            }}
            options={[{ value: '', label: 'Kho nguồn: Tất cả' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]}
          />
          <Combobox
            id="transfer-filter-to"
            value={toWarehouseId}
            onChange={(v) => {
              setToWarehouseId(v);
              setCursorStack([]);
            }}
            options={[{ value: '', label: 'Kho đích: Tất cả' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]}
          />
          <Combobox
            id="transfer-filter-status"
            value={status}
            onChange={(v) => {
              setStatus(v as StockTransferStatus | '');
              setCursorStack([]);
            }}
            options={[
              { value: '', label: 'Trạng thái: Tất cả' },
              { value: 'DRAFT', label: 'Nháp' },
              { value: 'IN_TRANSIT', label: 'Đang vận chuyển' },
              { value: 'COMPLETED', label: 'Hoàn tất' },
              { value: 'REJECTED', label: 'Từ chối' },
            ]}
          />
        </div>
        {canCreate && (
          <Button type="button" onClick={() => navigate('/inventory/transfers/new')}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Tạo phiếu điều chuyển
          </Button>
        )}
      </div>

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
        <EmptyState icon={Truck} title="Chưa có phiếu điều chuyển kho nào" description="Tạo phiếu để chuyển hàng giữa các kho." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách phiếu điều chuyển kho" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div role="row" style={{ gridTemplateColumns: GRID_COLUMNS }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-center">Số phiếu</div>
                <div role="columnheader" className="py-2.5 text-center">Kho nguồn → Kho đích</div>
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-center">Ngày chuyển</div>
                <div role="columnheader" className="py-2.5 text-center">Số dòng</div>
                <div role="columnheader" className="py-2.5 text-left">Người tạo</div>
                <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => (
                  <div
                    key={item.id}
                    role="row"
                    style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}
                    className={`grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50 ${item.status === 'IN_TRANSIT' ? 'bg-amber-50/50 hover:bg-amber-50' : ''} ${item.status === 'REJECTED' ? 'opacity-70' : ''}`}
                  >
                    <div role="cell" className={`truncate text-center font-semibold ${item.status === 'REJECTED' ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                      {item.transferNo}
                    </div>
                    <div role="cell" className="flex items-center justify-center gap-1.5 truncate font-medium text-slate-900">
                      <span className="truncate">{item.fromWarehouseName}</span>
                      <ArrowRight size={13} className="flex-shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="truncate">{item.toWarehouseName}</span>
                    </div>
                    <div role="cell" className="flex justify-center">
                      <StatusBadge tone={STATUS_META[item.status].tone}>{STATUS_META[item.status].label}</StatusBadge>
                    </div>
                    <div role="cell" className="text-center font-medium text-slate-600">{formatDateShort(item.occurredAt)}</div>
                    <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{item.lineCount}</div>
                    <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-600">{item.createdByName}</div>
                    <div role="cell" className="flex items-center justify-center gap-1.5">
                      <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => navigate(`/inventory/transfers/${item.id}`)} />
                      {item.status === 'DRAFT' && (
                        <>
                          {canCreate && <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => navigate(`/inventory/transfers/${item.id}`)} />}
                          {canApprove && <RowActionButton icon={X} label="Từ chối" tone="danger" onClick={() => setRejectTarget(item)} />}
                        </>
                      )}
                      {item.status === 'IN_TRANSIT' && canApprove && (
                        <button
                          type="button"
                          onClick={() => navigate(`/inventory/transfers/${item.id}`)}
                          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                        >
                          <Truck size={13} weight="bold" aria-hidden="true" />
                          Xác nhận nhận hàng
                        </button>
                      )}
                    </div>
                  </div>
                ))}
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
