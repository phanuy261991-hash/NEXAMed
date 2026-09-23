import { useState } from 'react';
import { Archive, ArrowCircleDown, ArrowCircleUp, DownloadSimple, Scales } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { DateInput } from '../../shared/ui/DateInput';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatCardRow } from '../../shared/ui/StatCard';
import { ApiError } from '../../shared/api/client';
import { useWarehousesQuery } from '../drug/warehouse.queries';
import { useExportStockLedgerReportMutation, useStockLedgerReportQuery } from './inventory.queries';

function getVietnamTodayDateString(): string {
  const now = new Date(Date.now() + 7 * 60 * 60_000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function monthStartDateString(): string {
  return `${getVietnamTodayDateString().slice(0, 7)}-01`;
}

/**
 * "Báo cáo Nhập-Xuất-Tồn" (Kho Thuốc GĐ4, docs/DECISIONS.md #170, kế hoạch kỹ thuật
 * bright-bubbling-axolotl.md mục 5, mockup NVC5A4uZsmX9kFsAk5Td88 đã duyệt) — bảng kê Đầu kỳ/Nhập/
 * Xuất/Cuối kỳ theo mặt hàng trong khoảng ngày, đúng khuôn "Báo cáo dòng tiền" của Sổ quỹ
 * (`CashFlowReportPage.tsx`). Quyền riêng `stock_receipt.report`, chỉ `clinic_admin`.
 */
export function StockLedgerReportPage() {
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Báo cáo Nhập-Xuất-Tồn' }]);

  const [dateFrom, setDateFrom] = useState(monthStartDateString());
  const [dateTo, setDateTo] = useState(getVietnamTodayDateString());
  const [warehouseId, setWarehouseId] = useState('');
  const warehousesQuery = useWarehousesQuery();

  const reportQuery = useStockLedgerReportQuery({ from: dateFrom, to: dateTo, warehouseId: warehouseId || undefined });
  const exportMutation = useExportStockLedgerReportMutation();

  const items = reportQuery.data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="slr-from" className="text-sm font-semibold text-slate-800">
              Từ ngày
            </label>
            <DateInput id="slr-from" value={dateFrom} onChange={setDateFrom} dense />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="slr-to" className="text-sm font-semibold text-slate-800">
              Đến ngày
            </label>
            <DateInput id="slr-to" value={dateTo} onChange={setDateTo} dense />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="slr-warehouse" className="text-sm font-semibold text-slate-800">
              Kho
            </label>
            <Combobox id="slr-warehouse" value={warehouseId} onChange={setWarehouseId} options={[{ value: '', label: 'Tất cả kho' }, ...(warehousesQuery.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))]} />
          </div>
        </div>
        <Button type="button" variant="secondary" loading={exportMutation.isPending} onClick={() => exportMutation.mutate({ from: dateFrom, to: dateTo, warehouseId: warehouseId || undefined })}>
          <DownloadSimple size={16} weight="bold" aria-hidden="true" />
          Xuất Excel
        </Button>
      </div>

      {reportQuery.isError && (
        <ErrorBanner message={reportQuery.error instanceof ApiError ? reportQuery.error.message : 'Không tải được báo cáo Nhập-Xuất-Tồn.'} onRetry={() => void reportQuery.refetch()} />
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
                { icon: Archive, tone: 'slate', label: 'Tổng đầu kỳ', value: reportQuery.data.totalOpeningQuantity.toLocaleString('vi-VN') },
                { icon: ArrowCircleDown, tone: 'emerald', label: 'Tổng nhập', value: `+${reportQuery.data.totalIn.toLocaleString('vi-VN')}` },
                { icon: ArrowCircleUp, tone: 'rose', label: 'Tổng xuất', value: `-${reportQuery.data.totalOut.toLocaleString('vi-VN')}` },
                { icon: Scales, tone: 'blue', label: 'Tổng cuối kỳ', value: reportQuery.data.totalClosingQuantity.toLocaleString('vi-VN'), emphasis: true },
              ]}
            />
          </div>

          {items.length === 0 ? (
            <EmptyState icon={Archive} title="Không có biến động tồn kho nào" description="Đổi lại khoảng ngày hoặc bộ lọc Kho để xem dữ liệu khác." />
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div role="table" aria-label="Báo cáo Nhập-Xuất-Tồn" className="scroll-hover h-full overflow-x-auto">
                <div className="flex h-full flex-col" style={{ minWidth: 900 }}>
                  <div
                    role="row"
                    style={{ gridTemplateColumns: '110px 1.6fr 90px 180px 120px 120px 120px 120px' }}
                    className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
                  >
                    <div role="columnheader" className="py-2.5 text-center">Mã</div>
                    <div role="columnheader" className="py-2.5 text-left">Tên mặt hàng</div>
                    <div role="columnheader" className="py-2.5 text-center">ĐVT</div>
                    <div role="columnheader" className="py-2.5 text-left">Kho</div>
                    <div role="columnheader" className="py-2.5 text-center">Đầu kỳ</div>
                    <div role="columnheader" className="py-2.5 text-center">Nhập</div>
                    <div role="columnheader" className="py-2.5 text-center">Xuất</div>
                    <div role="columnheader" className="py-2.5 text-center">Cuối kỳ</div>
                  </div>
                  <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                    {items.map((item) => (
                      <div
                        key={`${item.drugId}:${item.warehouseId}`}
                        role="row"
                        style={{ gridTemplateColumns: '110px 1.6fr 90px 180px 120px 120px 120px 120px', minHeight: 52 }}
                        className="grid items-center border-b border-slate-100 px-4 text-sm"
                      >
                        <div role="cell" className="text-center font-semibold text-slate-800">{item.drugCode}</div>
                        <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-900">{item.drugName}</div>
                        <div role="cell" className="text-center font-medium text-slate-600">{item.unitCode ?? '—'}</div>
                        <div role="cell" className="min-w-0 truncate text-left font-medium text-slate-600">{item.warehouseName}</div>
                        <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{item.openingQuantity.toLocaleString('vi-VN')}</div>
                        <div role="cell" className="text-center font-medium tabular-nums text-emerald-700">{item.totalIn > 0 ? `+${item.totalIn.toLocaleString('vi-VN')}` : '—'}</div>
                        <div role="cell" className="text-center font-medium tabular-nums text-rose-700">{item.totalOut > 0 ? `-${item.totalOut.toLocaleString('vi-VN')}` : '—'}</div>
                        <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{item.closingQuantity.toLocaleString('vi-VN')}</div>
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
