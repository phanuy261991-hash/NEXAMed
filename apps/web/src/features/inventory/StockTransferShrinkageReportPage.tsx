import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, CurrencyCircleDollar, DownloadSimple, Package, Receipt, Scales } from '@phosphor-icons/react';
import type { StockTransferShrinkageCause } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatCardRow } from '../../shared/ui/StatCard';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { useExportStockTransferShrinkageMutation, useStockTransferShrinkageQuery } from './inventory.queries';

const GRID = '130px 110px minmax(220px,1.3fr) minmax(220px,1.5fr) 90px 120px 130px 150px';
const CAUSE_META: Record<StockTransferShrinkageCause, { label: string; tone: 'danger' | 'accent' }> = {
  WRITE_OFF: { label: 'Ghi hao hụt', tone: 'danger' },
  RETURN_SHORTAGE: { label: 'Nhận lại thiếu', tone: 'accent' },
};

function vnToday(): string {
  const now = new Date(Date.now() + 7 * 60 * 60_000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function formatDateShort(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
}

/**
 * "Hao hụt điều chuyển" — tab thứ hai của trang Báo cáo Nhập-Xuất-Tồn (Đợt 2 chi nhánh, docs/DECISIONS.md #233; chủ dự án chốt gộp tab, thêm bộ lọc Kho gửi +
 * Nguyên nhân, dải 4 số và Xuất Excel). Phần hàng MẤT HẲN khi chuyển kho của chi nhánh GỬI đang làm việc: (1) hàng nhận thiếu mà bên gửi chọn "Ghi hao hụt";
 * (2) hàng bị từ chối nhận, nhận lại thiếu. Chi nhánh nhận không xem báo cáo này (Q5). Quyền `stock_receipt.report`.
 */
export function StockTransferShrinkageReport() {
  const [dateFrom, setDateFrom] = useState(`${vnToday().slice(0, 7)}-01`);
  const [dateTo, setDateTo] = useState(vnToday());
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [cause, setCause] = useState<StockTransferShrinkageCause | ''>('');
  const warehousesQuery = useWarehousesQuery();

  const query = { from: dateFrom, to: dateTo, fromWarehouseId: fromWarehouseId || undefined, cause: cause || undefined };
  const reportQuery = useStockTransferShrinkageQuery(query);
  const exportMutation = useExportStockTransferShrinkageMutation();
  const items = reportQuery.data?.items ?? [];

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tsr-from" className="text-sm font-semibold text-slate-800">
              Từ ngày
            </label>
            <DateInput id="tsr-from" value={dateFrom} onChange={setDateFrom} dense />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tsr-to" className="text-sm font-semibold text-slate-800">
              Đến ngày
            </label>
            <DateInput id="tsr-to" value={dateTo} onChange={setDateTo} dense />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tsr-warehouse" className="text-sm font-semibold text-slate-800">
              Kho gửi
            </label>
            <Combobox id="tsr-warehouse" value={fromWarehouseId} onChange={setFromWarehouseId} options={[{ value: '', label: 'Tất cả kho' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tsr-cause" className="text-sm font-semibold text-slate-800">
              Nguyên nhân
            </label>
            <Combobox
              id="tsr-cause"
              value={cause}
              onChange={(v) => setCause(v as StockTransferShrinkageCause | '')}
              options={[{ value: '', label: 'Tất cả' }, { value: 'WRITE_OFF', label: CAUSE_META.WRITE_OFF.label }, { value: 'RETURN_SHORTAGE', label: CAUSE_META.RETURN_SHORTAGE.label }]}
            />
          </div>
        </div>
        <Button type="button" variant="secondary" loading={exportMutation.isPending} onClick={() => exportMutation.mutate(query)}>
          <DownloadSimple size={16} weight="bold" aria-hidden="true" />
          Xuất Excel
        </Button>
      </div>

      {reportQuery.isError && (
        <ErrorBanner message={reportQuery.error instanceof ApiError ? reportQuery.error.message : 'Không tải được báo cáo hao hụt điều chuyển.'} onRetry={() => void reportQuery.refetch()} />
      )}

      {reportQuery.isPending && (
        <div className="space-y-2 rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {reportQuery.isSuccess && (
        <>
          <div className="flex flex-shrink-0 flex-wrap items-stretch gap-3">
            <StatCardRow
              items={[
                { icon: Package, tone: 'rose', label: 'Tổng số lượng hao hụt', value: reportQuery.data.totalQuantity.toLocaleString('vi-VN') },
                { icon: CurrencyCircleDollar, tone: 'blue', label: 'Tổng giá trị (giá vốn)', value: formatVnd(reportQuery.data.totalValue), emphasis: true },
                { icon: Receipt, tone: 'slate', label: 'Số phiếu có hao hụt', value: reportQuery.data.transferCount.toLocaleString('vi-VN') },
                {
                  icon: Scales,
                  tone: 'slate',
                  // Nhãn nêu thứ tự hai nhóm, giá trị chỉ là hai số — giữ ô gọn một dòng như các ô khác.
                  label: `${CAUSE_META.WRITE_OFF.label} / ${CAUSE_META.RETURN_SHORTAGE.label}`,
                  value: `${reportQuery.data.countByCause.WRITE_OFF} / ${reportQuery.data.countByCause.RETURN_SHORTAGE}`,
                },
              ]}
            />
          </div>

          {items.length === 0 ? (
            <EmptyState icon={Archive} title="Không có hao hụt điều chuyển nào" description="Đổi lại khoảng ngày hoặc bộ lọc để xem dữ liệu khác." />
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div role="table" aria-label="Báo cáo hao hụt điều chuyển" className="scroll-hover h-full overflow-x-auto">
                <div className="flex h-full flex-col" style={{ minWidth: 1150 }}>
                  <div role="row" style={{ gridTemplateColumns: GRID }} className="grid flex-shrink-0 gap-x-2 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800">
                    <div role="columnheader" className="py-2.5 text-center">Số phiếu</div>
                    <div role="columnheader" className="py-2.5 text-center">Ngày chuyển</div>
                    <div role="columnheader" className="py-2.5 text-left">Từ → Đến</div>
                    <div role="columnheader" className="py-2.5 text-left">Mặt hàng</div>
                    <div role="columnheader" className="py-2.5 text-center">SL</div>
                    <div role="columnheader" className="py-2.5 text-right">Giá vốn</div>
                    <div role="columnheader" className="py-2.5 text-right">Giá trị</div>
                    <div role="columnheader" className="py-2.5 text-center">Nguyên nhân</div>
                  </div>
                  <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                    {items.map((item, index) => (
                      <div key={`${item.transferId}:${item.drugCode}:${index}`} role="row" style={{ gridTemplateColumns: GRID, minHeight: 52 }} className="grid items-center gap-x-2 border-b border-slate-100 px-4 text-sm">
                        <div role="cell" className="truncate text-center font-semibold">
                          <Link to={`/inventory/transfers/${item.transferId}`} className="text-blue-700 hover:underline">
                            {item.transferNo}
                          </Link>
                        </div>
                        <div role="cell" className="text-center font-medium text-slate-600">{formatDateShort(item.occurredAt)}</div>
                        <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-800" title={`${item.fromWarehouseName} → ${item.toWarehouseName}`}>
                          {item.fromWarehouseName} → {item.toWarehouseName}
                        </div>
                        <div role="cell" className="min-w-0 text-left">
                          <p className="truncate font-bold text-slate-900" title={item.drugName}>{item.drugName}</p>
                          <p className="truncate text-xs font-medium text-slate-400">{item.drugCode}</p>
                        </div>
                        <div role="cell" className="text-center font-semibold tabular-nums text-rose-700">{item.quantity.toLocaleString('vi-VN')}</div>
                        <div role="cell" className="text-right tabular-nums text-slate-700">{formatVnd(item.unitCost)}</div>
                        <div role="cell" className="text-right font-semibold tabular-nums text-slate-900">{formatVnd(item.lineValue)}</div>
                        <div role="cell" className="flex justify-center">
                          <StatusBadge tone={CAUSE_META[item.cause].tone}>{CAUSE_META[item.cause].label}</StatusBadge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
