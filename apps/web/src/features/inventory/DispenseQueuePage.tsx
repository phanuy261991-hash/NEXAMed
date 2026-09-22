import { useState } from 'react';
import { Archive, Pill } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { TwoOptionToggle } from '../../shared/ui/TwoOptionToggle';
import { formatVnd } from '../../shared/format/currency';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useDispenseQueueQuery, useStockIssuesQuery } from './inventory.queries';
import { DispensePrescriptionDialog } from './DispensePrescriptionDialog';
import { StockIssueDetailDialog } from './StockIssueDetailDialog';

const GRID_COLUMNS = '160px 1fr 130px 130px 140px 1fr';
const TABLE_MIN_WIDTH_PX = 900;
const ROW_HEIGHT_PX = 56;

const ISSUED_GRID_COLUMNS = '150px 1fr 130px 120px 110px 130px';
const ISSUED_TABLE_MIN_WIDTH_PX = 900;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')} ${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/**
 * Tab "Đã phát hôm nay" — chủ dự án phản hồi trực tiếp (21/09/2026) trang "Phát thuốc" chỉ hiện
 * đơn CẦN phát, không có chỗ xem lại đơn đã phát trong ngày. Backend `GET /inventory/issues` đã hỗ
 * trợ sẵn từ GĐ3 (#163) nhưng chưa có trang web nào dùng tới — chỉ cần nối UI, không cần API mới.
 * Mặc định lọc đúng hôm nay (giờ Việt Nam), không có bộ lọc khoảng ngày (chưa được yêu cầu).
 */
function DispensedTodayPane() {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [viewingIssueId, setViewingIssueId] = useState<string | null>(null);
  const today = getVietnamTodayDateString();

  const listQuery = useStockIssuesQuery({ from: today, to: today, q: debouncedQ.trim() || undefined, limit: 50 });
  const items = listQuery.data?.items ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo số phiếu, tên, mã bệnh nhân..."
          className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      {listQuery.isError && (
        <ErrorBanner message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách đơn đã phát.'} onRetry={() => void listQuery.refetch()} />
      )}

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={Archive} title="Chưa phát đơn nào hôm nay" description="Đơn thuốc đã phát trong ngày sẽ hiện ở đây." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Đơn đã phát hôm nay" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: ISSUED_TABLE_MIN_WIDTH_PX }}>
              <div role="row" style={{ gridTemplateColumns: ISSUED_GRID_COLUMNS }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-center">Số phiếu</div>
                <div role="columnheader" className="py-2.5 text-left">Bệnh nhân</div>
                <div role="columnheader" className="py-2.5 text-center">Kho</div>
                <div role="columnheader" className="py-2.5 text-center">Giờ phát</div>
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-center">Tổng tiền</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => (
                  <div
                    key={item.id}
                    role="row"
                    style={{ gridTemplateColumns: ISSUED_GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}
                    className={`grid cursor-pointer items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50 ${item.status === 'VOIDED' ? 'opacity-60' : ''}`}
                    onClick={() => setViewingIssueId(item.id)}
                  >
                    <div role="cell" className={`truncate text-center font-medium ${item.status === 'VOIDED' ? 'text-slate-500 line-through' : 'text-blue-600'}`}>{item.issueNo}</div>
                    <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-900">
                      {item.patientFullName ?? '—'} {item.patientCode && <span className="text-xs text-slate-400">({item.patientCode})</span>}
                    </div>
                    <div role="cell" className="truncate text-center font-medium text-slate-600">{item.warehouseName}</div>
                    <div role="cell" className="text-center font-medium text-slate-600">{formatDateTime(item.occurredAt)}</div>
                    <div role="cell" className="flex justify-center">
                      <StatusBadge tone={item.status === 'VOIDED' ? 'neutral' : 'success'}>{item.status === 'VOIDED' ? 'Đã huỷ' : 'Đã phát'}</StatusBadge>
                    </div>
                    <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{formatVnd(item.totalAmount)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {viewingIssueId && <StockIssueDetailDialog issueId={viewingIssueId} onClose={() => setViewingIssueId(null)} />}
    </div>
  );
}

/**
 * "Phát thuốc" (Kho Thuốc GĐ3, docs/DECISIONS.md #163) — hàng đợi đơn ĐÃ KÝ còn thuốc chưa phát
 * hết, cho phòng khám có quầy thuốc/dược sĩ riêng. Đúng khuôn List Screen Pattern
 * `StockReceiptListPage.tsx`. Mặc định chỉ hiện đơn ký trong 30 ngày gần đây — gõ tìm (`q`) bỏ qua
 * giới hạn ngày, tìm xuyên suốt mọi thời điểm (dược sĩ tìm đúng đơn khi khách quay lại không nhớ
 * mã, không giới hạn theo trạng thái lượt khám/hoá đơn).
 *
 * Tab "Đã phát hôm nay" (21/09/2026, phản hồi trực tiếp) — xem `DispensedTodayPane` ở trên.
 */
export function DispenseQueuePage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Phát thuốc' }]);

  const [tab, setTab] = useState<'pending' | 'dispensed'>('pending');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [includeOlder, setIncludeOlder] = useState(false);
  const [dispensingPrescriptionId, setDispensingPrescriptionId] = useState<string | null>(null);

  const listQuery = useDispenseQueueQuery({ q: debouncedQ.trim() || undefined, includeOlder });
  const items = listQuery.data?.items ?? [];

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Phát thuốc</h1>

      <div className="flex-shrink-0 px-1">
        <TwoOptionToggle
          options={[
            { value: 'pending', label: 'Cần phát' },
            { value: 'dispensed', label: 'Đã phát hôm nay' },
          ]}
          value={tab}
          onChange={(next) => setTab(next ?? tab)}
        />
      </div>

      {tab === 'dispensed' ? (
        <DispensedTodayPane />
      ) : (
        <>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo tên, SĐT, mã bệnh nhân..."
          className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        {q.trim() === '' && (
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
            <input type="checkbox" checked={includeOlder} onChange={(e) => setIncludeOlder(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Hiện cả đơn cũ hơn 30 ngày
          </label>
        )}
      </div>

      {listQuery.isError && (
        <ErrorBanner message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được hàng đợi phát thuốc.'} onRetry={() => void listQuery.refetch()} />
      )}

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState icon={Pill} title="Không có đơn nào cần phát" description="Mọi đơn thuốc đã ký đều đã phát đủ, hoặc thử tìm theo tên/SĐT/mã bệnh nhân." />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Hàng đợi phát thuốc" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div role="row" style={{ gridTemplateColumns: GRID_COLUMNS }} className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
                <div role="columnheader" className="py-2.5 text-center">Mã lượt khám</div>
                <div role="columnheader" className="py-2.5 text-left">Bệnh nhân</div>
                <div role="columnheader" className="py-2.5 text-center">SĐT</div>
                <div role="columnheader" className="py-2.5 text-center">Ký lúc</div>
                <div role="columnheader" className="py-2.5 text-center">Đã phát / Đã kê</div>
                <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => (
                  <div
                    key={item.prescriptionId}
                    role="row"
                    style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}
                    className="grid cursor-pointer items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50"
                    onClick={() => setDispensingPrescriptionId(item.prescriptionId)}
                  >
                    <div role="cell" className="truncate text-center font-medium text-blue-600">{item.encounterNo}</div>
                    <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-900">
                      {item.patientFullName} <span className="text-xs text-slate-400">({item.patientCode})</span>
                    </div>
                    <div role="cell" className="text-center font-medium text-slate-600">{item.phone}</div>
                    <div role="cell" className="text-center font-medium text-slate-600">{formatDateTime(item.signedAt)}</div>
                    <div role="cell" className="text-center font-semibold tabular-nums text-amber-700">
                      {item.totalDispensedQuantity} / {item.totalPrescribedQuantity}
                    </div>
                    <div role="cell" className="flex justify-center">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDispensingPrescriptionId(item.prescriptionId); }} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700">
                        Phát thuốc
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {dispensingPrescriptionId && (
        <DispensePrescriptionDialog prescriptionId={dispensingPrescriptionId} onClose={() => setDispensingPrescriptionId(null)} />
      )}
        </>
      )}
    </div>
  );
}
