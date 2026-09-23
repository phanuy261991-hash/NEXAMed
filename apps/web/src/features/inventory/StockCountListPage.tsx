import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ClipboardText, Eye, PencilSimple, Plus, X } from '@phosphor-icons/react';
import type { StockCountStatus, StockCountSummary } from '@nexamed/shared';
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
import { useApproveStockCountMutation, useStockCountsQuery } from './inventory.queries';
import { StockCountApproveReasonDialog } from './StockCountApproveReasonDialog';
import { StockCountRejectDialog } from './StockCountRejectDialog';

const GRID_COLUMNS = '150px 150px 130px 90px 110px 1fr 1fr 200px';
const TABLE_MIN_WIDTH_PX = 1180;
const ROW_HEIGHT_PX = 56;
const PAGE_LIMIT = 50;

const STATUS_META: Record<StockCountStatus, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  POSTED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/**
 * "Kiểm kê" — Kho Thuốc GĐ4 (docs/DECISIONS.md #170, mockup `KiemKeList.dc.html` đã duyệt). List
 * Screen Pattern đúng khuôn `StockReceiptListPage.tsx` — Duyệt/Từ chối nằm NGAY TRONG hàng (đúng
 * mockup), "Sửa"/số phiếu điều hướng sang `StockCountFormPage` (trang riêng, không modal).
 */
export function StockCountListPage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Kiểm kê' }]);
  const navigate = useNavigate();
  const canCreate = useHasPermission('stock_count', 'create');
  const canApprove = useHasPermission('stock_count', 'approve');

  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState<StockCountStatus | ''>('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [rejectTarget, setRejectTarget] = useState<StockCountSummary | null>(null);
  const [approveReasonTarget, setApproveReasonTarget] = useState<StockCountSummary | null>(null);

  const cursor = cursorStack[cursorStack.length - 1];
  const listQuery = useStockCountsQuery({
    cursor,
    limit: PAGE_LIMIT,
    warehouseId: warehouseId || undefined,
    status: status || undefined,
    q: debouncedQ.trim() || undefined,
  });
  const warehousesQuery = useWarehousesQuery();
  const approveMutation = useApproveStockCountMutation();

  const items = listQuery.data?.items ?? [];

  async function handleApprove(item: StockCountSummary) {
    try {
      await approveMutation.mutateAsync({ id: item.id, body: { version: item.version } });
    } catch (err) {
      // Phiếu có dòng dư/thiếu (đọc tồn kho SỐNG lúc Duyệt) — mở popup bắt buộc nhập lý do rồi
      // duyệt lại, đúng khuôn `docs/DECISIONS.md` #171. Lỗi khác thì báo lỗi bình thường.
      if (err instanceof ApiError && err.code === 'STOCK_COUNT_APPROVAL_REASON_REQUIRED') {
        setApproveReasonTarget(item);
        return;
      }
      window.alert(err instanceof ApiError ? err.message : 'Duyệt phiếu thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Kiểm kê</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2.5 px-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursorStack([]);
            }}
            placeholder="Tìm mã phiếu..."
            className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <Combobox
            id="count-filter-warehouse"
            value={warehouseId}
            onChange={(v) => {
              setWarehouseId(v);
              setCursorStack([]);
            }}
            options={[{ value: '', label: 'Tất cả kho' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]}
          />
          <Combobox
            id="count-filter-status"
            value={status}
            onChange={(v) => {
              setStatus(v as StockCountStatus | '');
              setCursorStack([]);
            }}
            options={[
              { value: '', label: 'Tất cả trạng thái' },
              { value: 'DRAFT', label: 'Nháp' },
              { value: 'POSTED', label: 'Đã duyệt' },
              { value: 'REJECTED', label: 'Từ chối' },
            ]}
          />
        </div>
        {canCreate && (
          <Button type="button" onClick={() => navigate('/inventory/counts/new')}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Tạo phiếu kiểm kê
          </Button>
        )}
      </div>

      {listQuery.isError && (
        <ErrorBanner message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách phiếu kiểm kê.'} onRetry={() => void listQuery.refetch()} />
      )}

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={ClipboardText} title="Chưa có phiếu kiểm kê nào" description="Tạo phiếu kiểm kê để đối chiếu tồn kho thực tế với hệ thống." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách phiếu kiểm kê" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div role="row" style={{ gridTemplateColumns: GRID_COLUMNS }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-left">Mã phiếu</div>
                <div role="columnheader" className="py-2.5 text-left">Kho</div>
                <div role="columnheader" className="py-2.5 text-center">Ngày kiểm kê</div>
                <div role="columnheader" className="py-2.5 text-center">Số dòng</div>
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-left">Người tạo</div>
                <div role="columnheader" className="py-2.5 text-left">Người duyệt</div>
                <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => (
                  <div key={item.id} role="row" style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }} className="grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50">
                    <div role="cell" className="truncate text-left font-semibold text-slate-800">{item.countNo}</div>
                    <div role="cell" className="truncate text-left font-medium text-slate-900">{item.warehouseName}</div>
                    <div role="cell" className="text-center font-medium text-slate-600">{formatDateShort(item.occurredAt)}</div>
                    <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{item.lineCount}</div>
                    <div role="cell" className="flex justify-center">
                      <StatusBadge tone={STATUS_META[item.status].tone}>{STATUS_META[item.status].label}</StatusBadge>
                    </div>
                    <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-600">{item.createdByName}</div>
                    <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-600">{item.approvedByName ?? '—'}</div>
                    <div role="cell" className="flex items-center justify-center gap-1.5">
                      <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => navigate(`/inventory/counts/${item.id}`)} />
                      {item.status === 'DRAFT' && (
                        <>
                          {canCreate && <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => navigate(`/inventory/counts/${item.id}`)} />}
                          {canApprove && (
                            <>
                              <RowActionButton icon={X} label="Từ chối" tone="danger" onClick={() => setRejectTarget(item)} />
                              <RowActionButton icon={Check} label="Duyệt" tone="success" disabled={approveMutation.isPending} onClick={() => void handleApprove(item)} />
                            </>
                          )}
                        </>
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
        <StockCountRejectDialog
          countId={rejectTarget.id}
          countNo={rejectTarget.countNo}
          version={rejectTarget.version}
          onDone={() => setRejectTarget(null)}
          onClose={() => setRejectTarget(null)}
        />
      )}
      {approveReasonTarget && (
        <StockCountApproveReasonDialog
          countId={approveReasonTarget.id}
          countNo={approveReasonTarget.countNo}
          version={approveReasonTarget.version}
          onDone={() => setApproveReasonTarget(null)}
          onClose={() => setApproveReasonTarget(null)}
        />
      )}
    </div>
  );
}
