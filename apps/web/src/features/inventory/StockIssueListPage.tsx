import { useState } from 'react';
import { Export, Prohibit } from '@phosphor-icons/react';
import type { StockIssueStatus, StockIssueSummary, StockIssueType } from '@nexamed/shared';
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
import { useStockIssuesQuery } from './inventory.queries';
import { StockIssueDetailDialog } from './StockIssueDetailDialog';
import { StockIssueVoidDialog } from './StockIssueVoidDialog';

const GRID_COLUMNS = '130px 150px 110px 130px 1.3fr 110px 80px 130px 1fr 130px';
const TABLE_MIN_WIDTH_PX = 1300;
const ROW_HEIGHT_PX = 56;
const PAGE_LIMIT = 50;

const STATUS_META: Record<StockIssueStatus, { label: string; tone: StatusBadgeTone }> = {
  POSTED: { label: 'Đã xuất', tone: 'success' },
  VOIDED: { label: 'Đã huỷ', tone: 'neutral' },
};

/** Nhãn đầy đủ 7 giá trị enum (badge hiển thị an toàn dù loại nào xuất hiện) — chỉ 2 loại có dữ
 * liệu thật hiện nay (`RETAIL_SALE` từ GĐ3 #163, `COUNT_SHORTAGE` từ GĐ4 #170), 5 loại còn lại "để
 * sẵn" chưa có luồng nào sinh ra (đúng comment `stockIssueTypeSchema`, `packages/shared/src/inventory.ts`). */
const TYPE_LABEL: Record<StockIssueType, string> = {
  RETAIL_SALE: 'Phát thuốc theo đơn',
  INTERNAL_ALLOCATION: 'Cấp phát nội bộ',
  SERVICE_CONSUMPTION: 'Tiêu hao dịch vụ',
  TRANSFER_OUT: 'Chuyển kho',
  RETURN_TO_SUPPLIER: 'Trả nhà cung cấp',
  WRITE_OFF: 'Xuất huỷ (hỏng/hết hạn)',
  COUNT_SHORTAGE: 'Xuất cân bằng kiểm kê',
};

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/**
 * "Phiếu xuất kho" — liệt kê MỌI phiếu xuất (phát thuốc theo đơn, xuất cân bằng kiểm kê, và các
 * loại để sẵn cho GĐ4 sau này), mọi thời điểm — khác `DispenseQueuePage.tsx` (chỉ phục vụ luồng
 * dược sĩ: hàng đợi cần phát + tab "Đã phát hôm nay" giới hạn HÔM NAY). Rà soát lỗ hổng quy trình
 * 22/09/2026 (chủ dự án phát hiện): trước đây phiếu `COUNT_SHORTAGE` tự sinh từ Kiểm kê không có
 * nơi nào tra cứu được quá 1 ngày. List Screen Pattern đúng khuôn `StockReceiptListPage.tsx`, thêm
 * "Huỷ phiếu" ngay trong hàng (backend có sẵn từ GĐ3 nhưng chưa web nào gọi tới).
 */
export function StockIssueListPage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Phiếu xuất kho' }]);
  const canVoid = useHasPermission('stock_issue', 'create');

  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [warehouseId, setWarehouseId] = useState('');
  const [issueType, setIssueType] = useState<StockIssueType | ''>('');
  const [status, setStatus] = useState<StockIssueStatus | ''>('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [viewingIssueId, setViewingIssueId] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<StockIssueSummary | null>(null);

  const cursor = cursorStack[cursorStack.length - 1];
  const listQuery = useStockIssuesQuery({
    cursor,
    limit: PAGE_LIMIT,
    warehouseId: warehouseId || undefined,
    issueType: issueType || undefined,
    status: status || undefined,
    q: debouncedQ.trim() || undefined,
  });
  const warehousesQuery = useWarehousesQuery();

  const items = listQuery.data?.items ?? [];

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Phiếu xuất kho</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursorStack([]);
          }}
          placeholder="Tìm theo số phiếu, tên, mã bệnh nhân..."
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <Combobox
          id="issue-filter-type"
          value={issueType}
          onChange={(v) => {
            setIssueType(v as StockIssueType | '');
            setCursorStack([]);
          }}
          options={[
            { value: '', label: 'Loại phiếu: Tất cả' },
            { value: 'RETAIL_SALE', label: 'Phát thuốc theo đơn' },
            { value: 'COUNT_SHORTAGE', label: 'Xuất cân bằng kiểm kê' },
          ]}
        />
        <Combobox
          id="issue-filter-warehouse"
          value={warehouseId}
          onChange={(v) => {
            setWarehouseId(v);
            setCursorStack([]);
          }}
          options={[{ value: '', label: 'Kho: Tất cả' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]}
        />
        <Combobox
          id="issue-filter-status"
          value={status}
          onChange={(v) => {
            setStatus(v as StockIssueStatus | '');
            setCursorStack([]);
          }}
          options={[
            { value: '', label: 'Trạng thái: Tất cả' },
            { value: 'POSTED', label: 'Đã xuất' },
            { value: 'VOIDED', label: 'Đã huỷ' },
          ]}
        />
      </div>

      {listQuery.isError && (
        <ErrorBanner message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách phiếu xuất kho.'} onRetry={() => void listQuery.refetch()} />
      )}

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={Export} title="Chưa có phiếu xuất kho nào" description="Phiếu xuất sinh ra từ Phát thuốc hoặc Kiểm kê sẽ hiện ở đây." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách phiếu xuất kho" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div role="row" style={{ gridTemplateColumns: GRID_COLUMNS }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-center">Số phiếu</div>
                <div role="columnheader" className="py-2.5 text-center">Loại phiếu</div>
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-center">Kho</div>
                <div role="columnheader" className="py-2.5 text-left">Bệnh nhân</div>
                <div role="columnheader" className="py-2.5 text-center">Ngày xuất</div>
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
                    className={`grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50 ${item.status === 'VOIDED' ? 'opacity-60' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => setViewingIssueId(item.id)}
                      role="cell"
                      className={`truncate text-center font-medium ${item.status === 'VOIDED' ? 'text-slate-500 line-through' : 'text-blue-600 hover:text-blue-700'}`}
                    >
                      {item.issueNo}
                    </button>
                    <div role="cell" className="text-center">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{TYPE_LABEL[item.issueType]}</span>
                    </div>
                    <div role="cell" className="flex justify-center">
                      <StatusBadge tone={STATUS_META[item.status].tone}>{STATUS_META[item.status].label}</StatusBadge>
                    </div>
                    <div role="cell" className="truncate text-center font-medium text-slate-900">{item.warehouseName}</div>
                    <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-900">
                      {item.patientFullName ?? '—'} {item.patientCode && <span className="text-xs text-slate-400">({item.patientCode})</span>}
                    </div>
                    <div role="cell" className="text-center font-medium text-slate-600">{formatDateShort(item.occurredAt)}</div>
                    <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{item.lineCount}</div>
                    <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{formatVnd(item.totalAmount)}</div>
                    <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-600">{item.createdByName}</div>
                    <div role="cell" className="flex items-center justify-center gap-1.5">
                      {item.status === 'POSTED' && canVoid && <RowActionButton icon={Prohibit} label="Huỷ phiếu" tone="danger" onClick={() => setVoidTarget(item)} />}
                      {item.status === 'VOIDED' && <span className="text-xs font-medium text-slate-400">—</span>}
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

      {viewingIssueId && <StockIssueDetailDialog issueId={viewingIssueId} onClose={() => setViewingIssueId(null)} />}
      {voidTarget && (
        <StockIssueVoidDialog
          issueId={voidTarget.id}
          issueNo={voidTarget.issueNo}
          version={voidTarget.version}
          onDone={() => setVoidTarget(null)}
          onClose={() => setVoidTarget(null)}
        />
      )}
    </div>
  );
}
