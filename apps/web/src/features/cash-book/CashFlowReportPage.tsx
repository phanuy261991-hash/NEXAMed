import { useState } from 'react';
import { ArrowCircleDown, ArrowCircleUp, DownloadSimple, Scales } from '@phosphor-icons/react';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useCashFlowReportQuery, useExportCashFlowReportMutation } from './cash-flow-report.queries';

function monthStartDateString(): string {
  return `${getVietnamTodayDateString().slice(0, 7)}-01`;
}

/**
 * "Báo cáo dòng tiền" (Sổ quỹ & Thu chi GĐ2) — tổng hợp toàn phòng khám, KHÔNG phải "báo cáo doanh
 * thu theo kỳ" (loại khỏi phạm vi v1, CLAUDE.md): không doanh thu, không công nợ, không lãi/lỗ —
 * thuần bảng kê tiền mặt/tiền vào-ra thật đã ghi nhận. `cash_voucher.report` — CHỈ `clinic_admin`.
 * Chuyển quỹ giữa 2 quỹ nội bộ LOẠI TRỪ khỏi tổng/theo Loại thu chi (không phải doanh thu/chi phí
 * thật) nhưng CÓ trong "Theo Quỹ" (đứng từ góc 1 quỹ, tiền thật sự ra/vào).
 */
export function CashFlowReportPage() {
  useBreadcrumb([{ label: 'Sổ quỹ & Thu chi' }, { label: 'Báo cáo dòng tiền' }]);

  const [dateFrom, setDateFrom] = useState(monthStartDateString());
  const [dateTo, setDateTo] = useState(getVietnamTodayDateString());

  const reportQuery = useCashFlowReportQuery({ from: dateFrom, to: dateTo });
  const exportMutation = useExportCashFlowReportMutation();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cfr-from" className="text-sm font-semibold text-slate-800">
              Từ ngày
            </label>
            <input id="cfr-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cfr-to" className="text-sm font-semibold text-slate-800">
              Đến ngày
            </label>
            <input id="cfr-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          </div>
        </div>
        <Button type="button" variant="secondary" loading={exportMutation.isPending} onClick={() => exportMutation.mutate({ from: dateFrom, to: dateTo })}>
          <DownloadSimple size={16} weight="bold" aria-hidden="true" />
          Xuất Excel
        </Button>
      </div>

      {reportQuery.isError && (
        <ErrorBanner message={reportQuery.error instanceof ApiError ? reportQuery.error.message : 'Không tải được báo cáo dòng tiền.'} onRetry={() => void reportQuery.refetch()} />
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
            <div className="flex min-w-[210px] flex-1 items-center gap-3.5 rounded-xl border border-emerald-100 bg-emerald-50/50 px-5 py-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-100">
                <ArrowCircleDown size={22} weight="bold" aria-hidden="true" />
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">Tổng thu</span>
                <span className="truncate text-2xl font-bold tabular-nums text-slate-900">{formatVnd(reportQuery.data.totalIncome)}</span>
              </div>
            </div>
            <div className="flex min-w-[210px] flex-1 items-center gap-3.5 rounded-xl border border-rose-100 bg-rose-50/50 px-5 py-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-rose-600 shadow-sm ring-1 ring-rose-100">
                <ArrowCircleUp size={22} weight="bold" aria-hidden="true" />
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="text-xs font-bold uppercase tracking-wide text-rose-700">Tổng chi</span>
                <span className="truncate text-2xl font-bold tabular-nums text-slate-900">{formatVnd(reportQuery.data.totalExpense)}</span>
              </div>
            </div>
            <div className="flex min-w-[210px] flex-1 items-center gap-3.5 rounded-xl border border-blue-100 bg-blue-50/50 px-5 py-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-blue-600 shadow-sm ring-1 ring-blue-100">
                <Scales size={22} weight="bold" aria-hidden="true" />
              </div>
              <div className="flex min-w-0 flex-col">
                <span className="text-xs font-bold uppercase tracking-wide text-blue-700">Chênh lệch</span>
                <span className="truncate text-2xl font-bold tabular-nums text-slate-900">{formatVnd(reportQuery.data.totalIncome - reportQuery.data.totalExpense)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-800">Theo Loại thu chi</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                    <th className="px-4 py-2 text-left">Loại thu chi</th>
                    <th className="px-4 py-2 text-right">Tổng thu</th>
                    <th className="px-4 py-2 text-right">Tổng chi</th>
                  </tr>
                </thead>
                <tbody>
                  {reportQuery.data.byType.map((g) => (
                    <tr key={g.key} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 font-medium text-slate-800">{g.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{g.totalIncome > 0 ? formatVnd(g.totalIncome) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-rose-700">{g.totalExpense > 0 ? formatVnd(g.totalExpense) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-800">Theo Quỹ</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                    <th className="px-4 py-2 text-left">Quỹ</th>
                    <th className="px-4 py-2 text-right">Tổng thu</th>
                    <th className="px-4 py-2 text-right">Tổng chi</th>
                    <th className="px-4 py-2 text-right">Tồn quỹ</th>
                  </tr>
                </thead>
                <tbody>
                  {reportQuery.data.byAccount.map((g) => (
                    <tr key={g.key} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 font-medium text-slate-800">{g.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{g.totalIncome > 0 ? formatVnd(g.totalIncome) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-rose-700">{g.totalExpense > 0 ? formatVnd(g.totalExpense) : '—'}</td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums text-slate-900">{formatVnd(g.closingBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
