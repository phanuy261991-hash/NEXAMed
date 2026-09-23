import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Check, Eye, PencilSimple, Plus, Prohibit, Warning, X } from '@phosphor-icons/react';
import type { StockReceiptStatus, StockReceiptSummary, StockReceiptType } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useHasPermission } from '../auth/usePermission';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import {
  useApproveStockReceiptMutation,
  useRejectStockReceiptMutation,
  useStockExpiryWarningsQuery,
  useStockReceiptsQuery,
  useVoidStockReceiptMutation,
} from './inventory.queries';
import { ReasonConfirmDialog } from './ReasonConfirmDialog';

const GRID_COLUMNS = '130px 150px 110px 130px 1.3fr 110px 80px 130px 1fr 170px';
const TABLE_MIN_WIDTH_PX = 1300;
const ROW_HEIGHT_PX = 56;
const PAGE_LIMIT = 50;

const STATUS_META: Record<StockReceiptStatus, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  POSTED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

const TYPE_LABEL: Record<StockReceiptType, string> = {
  PURCHASE: 'Nhập nhà cung cấp',
  OPENING_BALANCE: 'Nhập khởi tạo (Đầu kỳ)',
  TRANSFER_IN: 'Nhập chuyển kho',
  RETURN_FROM_USE: 'Nhập hoàn trả',
  COUNT_SURPLUS: 'Nhập cân bằng kiểm kê',
};

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/**
 * "Phiếu nhập kho" — Kho Thuốc GĐ2 (docs/DECISIONS.md #146, mockup precious-humming-goblet.md đã
 * duyệt). List Screen Pattern đúng khuôn `CashVoucherListPage.tsx` — nhưng thao tác Duyệt/Từ chối/
 * Huỷ nằm NGAY TRONG hàng (không tách dialog chi tiết riêng, đúng mockup), "Sửa"/số phiếu điều
 * hướng sang `StockReceiptFormPage` (trang riêng, không modal).
 */
export function StockReceiptListPage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Phiếu nhập kho' }]);
  const navigate = useNavigate();
  const canCreate = useHasPermission('stock_receipt', 'create');
  const canApprove = useHasPermission('stock_receipt', 'approve');

  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [warehouseId, setWarehouseId] = useState('');
  const [receiptType, setReceiptType] = useState<StockReceiptType | ''>('');
  const [status, setStatus] = useState<StockReceiptStatus | ''>('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [rejectTarget, setRejectTarget] = useState<StockReceiptSummary | null>(null);
  const [voidTarget, setVoidTarget] = useState<StockReceiptSummary | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const cursor = cursorStack[cursorStack.length - 1];
  const listQuery = useStockReceiptsQuery({
    cursor,
    limit: PAGE_LIMIT,
    warehouseId: warehouseId || undefined,
    receiptType: receiptType || undefined,
    status: status || undefined,
    q: debouncedQ.trim() || undefined,
  });
  const warehousesQuery = useWarehousesQuery();
  const expiryQuery = useStockExpiryWarningsQuery(warehouseId || undefined);
  const approveMutation = useApproveStockReceiptMutation();
  const rejectMutation = useRejectStockReceiptMutation();
  const voidMutation = useVoidStockReceiptMutation();

  const warehouseName = useMemo(() => {
    const map = new Map((warehousesQuery.data?.items ?? []).map((w) => [w.id, w.name]));
    return (id: string) => map.get(id) ?? '—';
  }, [warehousesQuery.data]);

  const items = listQuery.data?.items ?? [];
  const expiringSoonCount = expiryQuery.data?.expiringSoonCount ?? 0;
  const expiredCount = expiryQuery.data?.expiredCount ?? 0;
  const showExpiryBanner = !bannerDismissed && (expiringSoonCount > 0 || expiredCount > 0);

  async function handleApprove(item: StockReceiptSummary) {
    try {
      await approveMutation.mutateAsync({ id: item.id, body: { version: item.version } });
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Duyệt phiếu thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Phiếu nhập kho</h1>

      {showExpiryBanner && (
        <div className="flex flex-shrink-0 items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <Warning size={20} weight="fill" className="mt-0.5 flex-shrink-0 text-amber-500" aria-hidden="true" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-900">
              {expiringSoonCount > 0 && <span className="font-bold">{expiringSoonCount} lô</span>}
              {expiringSoonCount > 0 && ' sắp hết hạn trong 30 ngày tới'}
              {expiringSoonCount > 0 && expiredCount > 0 && ' · '}
              {expiredCount > 0 && <span className="font-bold text-rose-700">{expiredCount} lô</span>}
              {expiredCount > 0 && ' đã hết hạn'}
            </p>
            <p className="text-xs font-medium text-amber-700">Kiểm tra kỹ trước khi bán hoặc sử dụng cho bệnh nhân.</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => navigate('/inventory/balances?view=expiry')}>
            Xem chi tiết
          </Button>
          <button type="button" aria-label="Đóng cảnh báo" onClick={() => setBannerDismissed(true)} className="flex-shrink-0 text-amber-500 hover:text-amber-700">
            ✕
          </button>
        </div>
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
            placeholder="Tìm theo số phiếu, nhà cung cấp..."
            className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <Combobox
            id="receipt-filter-type"
            value={receiptType}
            onChange={(v) => {
              setReceiptType(v as StockReceiptType | '');
              setCursorStack([]);
            }}
            options={[
              { value: '', label: 'Loại phiếu: Tất cả' },
              { value: 'PURCHASE', label: 'Nhập nhà cung cấp' },
              { value: 'OPENING_BALANCE', label: 'Nhập khởi tạo (Đầu kỳ)' },
            ]}
          />
          <Combobox
            id="receipt-filter-warehouse"
            value={warehouseId}
            onChange={(v) => {
              setWarehouseId(v);
              setCursorStack([]);
            }}
            options={[{ value: '', label: 'Kho: Tất cả' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]}
          />
          <Combobox
            id="receipt-filter-status"
            value={status}
            onChange={(v) => {
              setStatus(v as StockReceiptStatus | '');
              setCursorStack([]);
            }}
            options={[
              { value: '', label: 'Trạng thái: Tất cả' },
              { value: 'DRAFT', label: 'Nháp' },
              { value: 'POSTED', label: 'Đã duyệt' },
              { value: 'REJECTED', label: 'Từ chối' },
            ]}
          />
        </div>
        {canCreate && (
          <Button type="button" onClick={() => navigate('/inventory/receipts/new')}>
            <Plus size={16} weight="bold" aria-hidden="true" />
            Tạo phiếu nhập
          </Button>
        )}
      </div>

      {listQuery.isError && (
        <ErrorBanner message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách phiếu nhập kho.'} onRetry={() => void listQuery.refetch()} />
      )}

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={Archive} title="Chưa có phiếu nhập kho nào" description="Tạo phiếu nhập để ghi nhận hàng nhập vào kho." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách phiếu nhập kho" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div role="row" style={{ gridTemplateColumns: GRID_COLUMNS }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-center">Số phiếu</div>
                <div role="columnheader" className="py-2.5 text-center">Loại phiếu</div>
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-center">Kho</div>
                <div role="columnheader" className="py-2.5 text-left">Nhà cung cấp</div>
                <div role="columnheader" className="py-2.5 text-center">Ngày nhập</div>
                <div role="columnheader" className="py-2.5 text-center">Số dòng</div>
                <div role="columnheader" className="py-2.5 text-center">Tổng tiền</div>
                <div role="columnheader" className="py-2.5 text-left">Người tạo</div>
                <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => (
                  <div
                    key={item.id}
                    role="row"
                    style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}
                    className={`grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50 ${item.voided ? 'opacity-60' : item.status === 'REJECTED' ? 'opacity-70' : ''}`}
                  >
                    <div role="cell" className={`truncate text-center font-semibold ${item.voided ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                      {item.receiptNo}
                    </div>
                    <div role="cell" className="text-center">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.receiptType === 'OPENING_BALANCE' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-700'}`}
                      >
                        {TYPE_LABEL[item.receiptType]}
                      </span>
                    </div>
                    <div role="cell" className="flex justify-center">
                      {item.voided ? (
                        <StatusBadge tone="neutral">Đã huỷ</StatusBadge>
                      ) : (
                        <StatusBadge tone={STATUS_META[item.status].tone}>{STATUS_META[item.status].label}</StatusBadge>
                      )}
                    </div>
                    <div role="cell" className="truncate text-center font-medium text-slate-900">{warehouseName(item.warehouseId)}</div>
                    <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-900">{item.supplierName ?? '—'}</div>
                    <div role="cell" className="text-center font-medium text-slate-600">{formatDateShort(item.occurredAt)}</div>
                    <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{item.lineCount}</div>
                    <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{formatVnd(item.totalAmount)}</div>
                    <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-600">{item.createdByName}</div>
                    <div role="cell" className="flex items-center justify-center gap-1.5">
                      <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => navigate(`/inventory/receipts/${item.id}`)} />
                      {!item.voided && item.status === 'DRAFT' && (
                        <>
                          {canCreate && <RowActionButton icon={PencilSimple} label="Sửa" tone="primary" onClick={() => navigate(`/inventory/receipts/${item.id}`)} />}
                          {canApprove && (
                            <>
                              <RowActionButton icon={X} label="Từ chối" tone="danger" onClick={() => setRejectTarget(item)} />
                              <RowActionButton icon={Check} label="Duyệt" tone="success" disabled={approveMutation.isPending} onClick={() => void handleApprove(item)} />
                            </>
                          )}
                        </>
                      )}
                      {!item.voided && item.status === 'POSTED' && canApprove && (
                        <RowActionButton icon={Prohibit} label="Huỷ phiếu" tone="danger" onClick={() => setVoidTarget(item)} />
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
        <ReasonConfirmDialog
          title="Từ chối phiếu nhập kho?"
          description={`Phiếu ${rejectTarget.receiptNo} sẽ chuyển sang trạng thái Từ chối, không cộng vào tồn kho.`}
          confirmLabel="Xác nhận từ chối"
          confirmVariant="danger"
          onConfirm={(reason) => rejectMutation.mutateAsync({ id: rejectTarget.id, body: { reason, version: rejectTarget.version } })}
          onDone={() => setRejectTarget(null)}
          onClose={() => setRejectTarget(null)}
        />
      )}
      {voidTarget && (
        <ReasonConfirmDialog
          title="Huỷ phiếu nhập kho đã duyệt?"
          description={`Phiếu ${voidTarget.receiptNo} sẽ bị huỷ — tồn kho đã cộng từ phiếu này sẽ bị trừ ngược lại.`}
          confirmLabel="Xác nhận huỷ"
          confirmVariant="danger"
          onConfirm={(reason) => voidMutation.mutateAsync({ id: voidTarget.id, body: { reason, version: voidTarget.version } })}
          onDone={() => setVoidTarget(null)}
          onClose={() => setVoidTarget(null)}
        />
      )}
    </div>
  );
}
