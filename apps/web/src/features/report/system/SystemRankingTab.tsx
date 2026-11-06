import { useMemo } from 'react';
import { Trophy } from '@phosphor-icons/react';
import type { SystemRankingReport } from '@nexamed/shared';
import { formatVndPlain } from '../../../shared/format/currency';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { SegmentedToggle } from '../../../shared/ui/SegmentedToggle';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatCount } from '../operations/operations-model';
import type { OperationsPeriodParams } from '../operations/operations.api';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import { periodCaption } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportSystemExcel } from './system.api';
import { useSystemRankingQuery } from './system.queries';
import { RANKING_COLUMNS, RANKING_KIND_ITEMS, rankingRows, SYSTEM_PERIOD_KINDS, type RankingKind } from './system-model';
import { buildSystemRankingPrintSpec } from './system-print-builders';

function Body({ report, kind, from, to }: { report: SystemRankingReport; kind: RankingKind; from: string; to: string }) {
  const cols = RANKING_COLUMNS[kind];
  const rows = rankingRows(report, kind);
  if (rows.length === 0) return <EmptyState icon={Trophy} title={cols.empty} description="Đổi kỳ, loại xếp hạng hoặc phạm vi chi nhánh." />;
  const multi = report.branches.length > 1;
  const max = Math.max(0, ...rows.map((r) => r.total));
  const title = RANKING_KIND_ITEMS.find((i) => i.id === kind)?.label ?? '';
  return (
    <ReportCard title={`${title}, xếp theo ${cols.total.toLowerCase()}, ${periodCaption({ from, to })}`} hint={`${rows.length} mục đầu`}>
      <ReportGridTable
        ariaLabel={`Xếp hạng ${title.toLowerCase()}`}
        minWidth={multi ? 760 + report.branches.length * 120 : 760}
        columns={[
          { header: 'Hạng', width: '52px' },
          { header: 'Tên', width: 'minmax(180px, 1.4fr)' },
          { header: cols.subtitle, width: '120px' },
          { header: cols.quantity, align: 'right', width: '92px' },
          { header: cols.total, width: 'minmax(190px, 1.2fr)' },
          ...(multi ? report.branches.map((b) => ({ header: b.branchName, align: 'right' as const, width: 'minmax(100px, 0.8fr)' })) : []),
        ]}
        rows={rows.map((r, i) => [
          <span key="rk" className="font-semibold text-slate-700">{i + 1}</span>,
          <span key="n" className="font-semibold text-slate-900">{r.name}</span>,
          <span key="s" className="text-slate-700">{r.subtitle || '—'}</span>,
          formatCount(r.quantity),
          <div key="t" className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-x-2.5">
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-blue-700" style={{ width: `${barWidthPercent(r.total, max)}%` }} />
            </div>
            <span className={`text-right font-semibold tabular-nums ${r.total < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{formatVndPlain(r.total)}</span>
          </div>,
          ...(multi ? r.byBranch.map((v, bi) => <span key={`b${bi}`} className={v === 0 ? 'text-slate-400' : 'text-slate-800'}>{v === 0 ? '—' : formatVndPlain(v)}</span>) : []),
        ])}
        maxBodyHeightClass="max-h-[620px]"
      />
    </ReportCard>
  );
}

/** Tab "Xếp hạng": dịch vụ, bác sĩ, thuốc và vật tư của toàn phạm vi, kèm giá trị từng chi nhánh. */
export function SystemRankingTab({ period, scope, kind, onKindChange }: { period: ReportPeriodState; scope: ReportScopeState; kind: RankingKind; onKindChange: (next: RankingKind) => void }) {
  const control = useMemo(
    () => (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-slate-800">Xếp theo</span>
        <SegmentedToggle<RankingKind> items={RANKING_KIND_ITEMS} value={kind} onChange={onKindChange} ariaLabel="Loại xếp hạng" />
      </div>
    ),
    [kind, onKindChange],
  );
  return (
    <PeriodReportTab<SystemRankingReport, OperationsPeriodParams>
      period={period}
      scope={scope}
      kinds={SYSTEM_PERIOD_KINDS}
      controls={control}
      exportFile={(p) => exportSystemExcel('ranking', p)}
      useReport={useSystemRankingQuery}
      buildPrint={buildSystemRankingPrintSpec}
      errorMessage="Không tải được bảng xếp hạng."
    >
      {(report) => <Body report={report} kind={kind} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}
