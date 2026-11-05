import { useMemo, useState } from 'react';
import { ArrowClockwise, DownloadSimple } from '@phosphor-icons/react';
import type { DailyReportDay, DailyReportQuery } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { ApiError } from '../../shared/api/client';
import { formatClockTime } from '../../shared/format/time';
import { PrintButton } from '../../shared/print/PrintButton';
import { addDays, getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useAuthStore } from '../auth/auth.store';
import { ReportScopeControl, ReportScopeSummary } from '../branch/ReportScopeControl';
import { useReportScope } from '../branch/useReportScope';
import { DailyReportPrintView } from './DailyReportPrintView';
import { formatReportDayMonth } from './daily-report-model';
import { useDailyReportQuery, useExportDailyReportMutation } from './daily-report.queries';

/**
 * "Báo cáo ngày" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): tờ chốt ngày của chi nhánh đang làm hoặc nhiều chi nhánh (bộ chọn Phạm vi dùng chung #235). Chỉ HÔM NAY hoặc HÔM QUA.
 * Tờ in hiện sẵn trên màn hình; "In" in thẳng từ trình duyệt, "Xuất Excel" tải cùng số liệu. Máy chủ tính mọi số — trang này chỉ hiển thị.
 */
export function DailyReportPage() {
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Báo cáo ngày' }]);

  const [day, setDay] = useState<DailyReportDay>('today');
  const scope = useReportScope();
  const user = useAuthStore((s) => s.user);
  const query: DailyReportQuery = useMemo(() => ({ day, ...scope.selection }), [day, scope.selection]);
  const reportQuery = useDailyReportQuery(query);
  const exportMutation = useExportDailyReportMutation();

  const today = getVietnamTodayDateString();
  const dayItems = [
    { id: 'today' as const, label: `Hôm nay · ${formatReportDayMonth(today)}` },
    { id: 'yesterday' as const, label: `Hôm qua · ${formatReportDayMonth(addDays(today, -1))}` },
  ];
  const report = reportQuery.data;
  const multiBranch = (report?.branches.length ?? 0) > 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <h1 className="pb-1 text-[22px] font-semibold text-slate-900">Báo cáo ngày</h1>
          <ReportScopeControl scope={scope} />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-slate-800">Ngày</span>
            <SegmentedToggle<DailyReportDay> items={dayItems} value={day} onChange={setDay} ariaLabel="Chọn ngày của báo cáo" />
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {report && <span className="text-sm text-slate-600">Số lúc {formatClockTime(report.generatedAt)}</span>}
          <Button type="button" variant="secondary" loading={reportQuery.isFetching && !reportQuery.isPending} onClick={() => void reportQuery.refetch()}>
            <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
            Làm mới
          </Button>
          <Button type="button" variant="secondary" disabled={!report} loading={exportMutation.isPending} onClick={() => report && exportMutation.mutate({ query, date: report.date })}>
            <DownloadSimple size={16} weight="bold" aria-hidden="true" />
            Xuất Excel
          </Button>
          <PrintButton documentType="REPORT" variant="primary" disabled={!report} onPrint={() => window.print()}>
            In
          </PrintButton>
        </div>
      </div>

      <ReportScopeSummary scope={scope} />
      {multiBranch && report && (
        <p className="text-sm text-slate-600">
          Tờ in gồm 1 trang tổng và {report.branches.length} trang chi nhánh.
        </p>
      )}

      {reportQuery.isError && (
        <ErrorBanner message={reportQuery.error instanceof ApiError ? reportQuery.error.message : 'Không tải được báo cáo ngày.'} onRetry={() => void reportQuery.refetch()} />
      )}

      {reportQuery.isPending && (
        <div className="space-y-2 rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {report && (
        <div className="scroll-hover overflow-x-auto rounded-lg bg-slate-200 p-6">
          <DailyReportPrintView report={report} exportedBy={user?.displayName ?? user?.fullName ?? ''} />
        </div>
      )}
    </div>
  );
}
