import { Timer } from '@phosphor-icons/react';
import type { WaitingReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { formatCount, formatMinutes, formatPercent } from './operations-model';
import { buildWaitingPrintSpec } from './operations-print-builders';
import { useWaitingQuery } from './operations.queries';
import { PeriodReportTab } from './PeriodReportTab';

const over30Class = (percent: number | null) => (percent !== null && percent >= 20 ? 'font-semibold text-rose-700' : 'text-slate-700');

function kpis(report: WaitingReport): ReportKpiItem[] {
  const s = report.summary;
  return [
    { label: 'Lượt đo được', value: formatCount(s.measuredCount), sub: 'có cả giờ tiếp nhận và giờ vào khám' },
    { label: 'Chờ trung bình', value: formatMinutes(s.averageMinutes), tone: 'blue', sub: 'từ tiếp nhận đến vào khám' },
    { label: 'Chờ lâu nhất', value: formatMinutes(report.maxMinutes), sub: 'một lượt trong kỳ' },
    { label: 'Chờ quá 30 phút', value: formatPercent(s.over30Percent), tone: 'amber', sub: `${formatCount(s.over30Count)} trên ${formatCount(s.measuredCount)} lượt` },
  ];
}

function Body({ report }: { report: WaitingReport }) {
  if (report.summary.measuredCount === 0) {
    return <EmptyState icon={Timer} title="Chưa đo được thời gian chờ" description="Chưa có lượt khám nào trong kỳ có cả giờ tiếp nhận và giờ vào khám. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const columns = (first: string, firstWidth: string) => [
    { header: first, width: firstWidth },
    { header: 'Lượt', align: 'right' as const, width: '70px' },
    { header: 'Chờ TB', align: 'right' as const, width: '90px' },
    { header: 'Chờ > 30 phút', align: 'right' as const, width: 'minmax(110px, 1fr)' },
  ];
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu thời gian chờ" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ReportCard title="Theo bác sĩ" hint="Xếp theo số lượt">
          <ReportGridTable
            ariaLabel="Thời gian chờ theo bác sĩ"
            columns={columns('Bác sĩ', 'minmax(140px, 1.4fr)')}
            rows={report.byDoctor.map((d) => [
              <span key="n" className="font-semibold text-slate-900">{d.doctorName}</span>,
              formatCount(d.visits),
              <span key="w" className="font-semibold">{d.averageMinutes === null ? '—' : `${d.averageMinutes} phút`}</span>,
              <span key="o" className={over30Class(d.over30Percent)}>{formatPercent(d.over30Percent)} ({formatCount(d.over30Count)})</span>,
            ])}
            emptyText="Chưa đo được thời gian chờ của lượt nào."
            maxBodyHeightClass="max-h-[480px]"
          />
        </ReportCard>
        <ReportCard title="Theo ngày" hint="Ngày tiếp nhận">
          <ReportGridTable
            ariaLabel="Thời gian chờ theo ngày"
            columns={columns('Ngày', '110px')}
            rows={report.byDay.map((d) => [
              <span key="d" className="font-semibold">{formatDobDisplay(d.date)}</span>,
              formatCount(d.visits),
              <span key="w" className="font-semibold">{d.averageMinutes === null ? '—' : `${d.averageMinutes} phút`}</span>,
              <span key="o" className={over30Class(d.over30Percent)}>{formatPercent(d.over30Percent)} ({formatCount(d.over30Count)})</span>,
            ])}
            emptyText="Chưa đo được thời gian chờ của lượt nào."
            maxBodyHeightClass="max-h-[480px]"
          />
        </ReportCard>
      </div>
    </>
  );
}

/** Tab "Thời gian chờ": từ tiếp nhận đến vào khám, theo bác sĩ và theo ngày. */
export function WaitingTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab period={period} scope={scope} exportKind="waiting" useReport={useWaitingQuery} buildPrint={buildWaitingPrintSpec} errorMessage="Không tải được báo cáo thời gian chờ.">
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
