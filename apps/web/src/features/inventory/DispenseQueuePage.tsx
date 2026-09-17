import { useState } from 'react';
import { Pill } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useDispenseQueueQuery } from './inventory.queries';
import { DispensePrescriptionDialog } from './DispensePrescriptionDialog';

const GRID_COLUMNS = '160px 1fr 130px 130px 140px 1fr';
const TABLE_MIN_WIDTH_PX = 900;
const ROW_HEIGHT_PX = 56;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')} ${String(vn.getUTCDate()).padStart(2, '0')}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${vn.getUTCFullYear()}`;
}

/**
 * "Phát thuốc" (Kho Thuốc GĐ3, docs/DECISIONS.md #163) — hàng đợi đơn ĐÃ KÝ còn thuốc chưa phát
 * hết, cho phòng khám có quầy thuốc/dược sĩ riêng. Đúng khuôn List Screen Pattern
 * `StockReceiptListPage.tsx`. Mặc định chỉ hiện đơn ký trong 30 ngày gần đây — gõ tìm (`q`) bỏ qua
 * giới hạn ngày, tìm xuyên suốt mọi thời điểm (dược sĩ tìm đúng đơn khi khách quay lại không nhớ
 * mã, không giới hạn theo trạng thái lượt khám/hoá đơn).
 */
export function DispenseQueuePage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Phát thuốc' }]);

  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [includeOlder, setIncludeOlder] = useState(false);
  const [dispensingPrescriptionId, setDispensingPrescriptionId] = useState<string | null>(null);

  const listQuery = useDispenseQueueQuery({ q: debouncedQ.trim() || undefined, includeOlder });
  const items = listQuery.data?.items ?? [];

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Phát thuốc</h1>

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
    </div>
  );
}
