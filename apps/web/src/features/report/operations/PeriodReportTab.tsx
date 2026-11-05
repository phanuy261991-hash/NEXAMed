import { useMemo, type ReactNode } from 'react';
import { useMutation, type UseQueryResult } from '@tanstack/react-query';
import type { ReportScopeSelection } from '@nexamed/shared';
import { ErrorBanner } from '../../../shared/ui/ErrorBanner';
import { ListLoadError } from '../../../shared/ui/ListLoadError';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ReportPrintAction } from '../../../shared/print/ReportPrintAction';
import type { ReportPrintSpec } from '../../../shared/print/report-print-spec';
import { ReportScopeControl } from '../../branch/ReportScopeControl';
import type { ReportScopeState } from '../../branch/useReportScope';
import { ReportActionBar } from '../ReportActionBar';
import { ReportPeriodControl } from '../ReportPeriodControl';
import type { PeriodKind } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportOperationsExcel, type OperationsExportKind, type OperationsPeriodParams } from './operations.api';

/** Kỳ của mọi tab trong nhóm (đúng mockup Giờ cao điểm): Tháng này, Tháng trước, Quý, Tuỳ chọn. Mọi tab dùng CÙNG tập kỳ vì trạng thái kỳ được giữ chung giữa các tab. */
export const OPERATIONS_PERIOD_KINDS: readonly PeriodKind[] = ['thisMonth', 'lastMonth', 'quarter', 'custom'];

export interface PrintContext {
  from: string;
  to: string;
  scopeLabel: string | null;
}

/** Chữ "Phạm vi" của bản in: không ghi khi chỉ chi nhánh đang làm; gộp thì ghi "Tất cả chi nhánh" hoặc số chi nhánh đã chọn. */
export function scopeText(selection: ReportScopeSelection, branchCount: number): string | null {
  if (selection.scope === 'current' || branchCount <= 1) return null;
  return selection.scope === 'all' ? `Tất cả chi nhánh (${branchCount})` : `${branchCount} chi nhánh đã chọn`;
}

/**
 * Khung CHUNG của một tab báo cáo theo kỳ trong nhóm "Khám bệnh và vận hành" (docs/DECISIONS.md #287, mockup đã duyệt): thanh lọc (Phạm vi + Kỳ) bên trái, "Số lúc / Làm mới / Xuất Excel / In"
 * bên phải, rồi nội dung. Lo đủ 4 trạng thái (đang tải, lỗi kèm "Thử lại", kỳ nhập sai, dữ liệu); mỗi tab chỉ truyền cách tải, cách dựng bản in và phần thân. Kỳ "Tuỳ chọn" nhập sai thì KHÔNG gọi
 * máy chủ mà báo ngay. Số chỉ tải khi vào tab, đổi bộ lọc hoặc bấm "Làm mới".
 */
export function PeriodReportTab<T extends { generatedAt: string; branchCount: number }, P extends OperationsPeriodParams = OperationsPeriodParams>({
  period,
  scope,
  exportKind,
  exportFile,
  kinds = OPERATIONS_PERIOD_KINDS,
  controls,
  extraParams,
  useReport,
  buildPrint,
  errorMessage,
  children,
}: {
  period: ReportPeriodState;
  scope: ReportScopeState;
  /** Excel của nhóm "Khám bệnh và vận hành"; báo cáo ở nhóm khác truyền `exportFile` thay vào đây. */
  exportKind?: OperationsExportKind;
  exportFile?: (params: P) => Promise<void>;
  /** Các kỳ báo cáo cho phép; mặc định bốn kỳ của nhóm vận hành. */
  kinds?: readonly PeriodKind[];
  /** Bộ lọc riêng của báo cáo (ví dụ "Gom theo"), đặt ngay sau bộ chọn Kỳ. */
  controls?: ReactNode;
  /** Tham số riêng thêm vào yêu cầu (ví dụ `groupBy`); đổi giá trị là tải lại. */
  extraParams?: Omit<P, keyof OperationsPeriodParams>;
  useReport: (params: P, enabled: boolean) => UseQueryResult<T>;
  buildPrint: (report: T, ctx: PrintContext) => ReportPrintSpec;
  errorMessage: string;
  children: (report: T) => ReactNode;
}) {
  const extraKey = JSON.stringify(extraParams ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `extraParams` so sánh theo nội dung qua `extraKey`, nơi gọi không cần giữ nguyên tham chiếu.
  const params = useMemo(() => ({ from: period.range.from, to: period.range.to, ...scope.selection, ...extraParams }) as P, [period.range.from, period.range.to, scope.selection, extraKey]);
  const query = useReport(params, period.error === null);
  const exportMutation = useMutation({ mutationFn: (p: P) => (exportFile ? exportFile(p) : exportOperationsExcel(exportKind!, p)) });
  const report = query.data;
  const printSpec = useMemo(
    () => (report ? buildPrint(report, { from: params.from, to: params.to, scopeLabel: scopeText(scope.selection, report.branchCount) }) : null),
    [report, buildPrint, params.from, params.to, scope.selection],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <ReportScopeControl scope={scope} />
          <ReportPeriodControl period={period} kinds={kinds} />
          {controls}
        </div>
        <ReportActionBar
          generatedAt={report?.generatedAt}
          onRefresh={() => void query.refetch()}
          refreshing={query.isFetching && !query.isPending}
          onExport={() => exportMutation.mutate(params)}
          exporting={exportMutation.isPending}
          exportDisabled={!report || period.error !== null}
          print={<ReportPrintAction spec={printSpec} disabled={!report || period.error !== null} />}
        />
      </div>

      {period.error !== null ? (
        <ErrorBanner message={period.error} />
      ) : query.isPending ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-busy="true" aria-label="Đang tải báo cáo">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ListLoadError error={query.error} fallbackMessage={errorMessage} onRetry={() => void query.refetch()} fallbackTo="/reports" fallbackLabel="Về Trung tâm báo cáo" />
      ) : report ? (
        children(report)
      ) : null}
    </div>
  );
}
