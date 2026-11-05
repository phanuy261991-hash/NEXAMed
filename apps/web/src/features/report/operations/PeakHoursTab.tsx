import { ChartBar } from '@phosphor-icons/react';
import type { PeakHoursReport } from '@nexamed/shared';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import { periodCaption } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import { barWidthPercent, formatCount, formatMinutes, formatPeak, formatPercent, heatCellStyle, heatMax, WEEKDAY_LABEL } from './operations-model';
import { buildPeakHoursPrintSpec } from './operations-print-builders';
import { usePeakHoursQuery } from './operations.queries';
import { PeriodReportTab } from './PeriodReportTab';

/** Màu thanh theo mốc thời gian chờ (xanh lá → đỏ khi chờ càng lâu), đúng mockup. */
const DISTRIBUTION_BAR_CLASS = ['bg-emerald-700', 'bg-teal-700', 'bg-blue-700', 'bg-amber-700', 'bg-rose-700'] as const;

function kpis(report: PeakHoursReport): ReportKpiItem[] {
  const w = report.waiting;
  return [
    { label: 'Giờ cao điểm', value: formatPeak(report.peak), tone: 'blue', sub: report.peak ? `${formatCount(report.peak.count)} lượt trong một giờ` : 'chưa có lượt khám' },
    { label: 'Chờ trung bình', value: formatMinutes(w.averageMinutes), sub: 'từ tiếp nhận đến vào khám' },
    { label: 'Chờ quá 30 phút', value: formatPercent(w.over30Percent), tone: 'amber', sub: `${formatCount(w.over30Count)} trên ${formatCount(w.measuredCount)} lượt` },
    {
      label: 'Ngày ít khách nhất',
      value: report.quietestDay ? (WEEKDAY_LABEL[report.quietestDay.isoDow] ?? '—') : '—',
      sub: report.quietestDay ? `chỉ ${formatCount(report.quietestDay.total)} lượt cả ngày` : 'chưa có lượt khám',
    },
  ];
}

function Heatmap({ report }: { report: PeakHoursReport }) {
  const max = heatMax(report.days);
  const template = `92px repeat(${report.hours.length}, minmax(48px, 1fr)) 72px`;
  return (
    <div className="scroll-hover overflow-x-auto p-4">
      <div role="table" aria-label="Lượt khám theo thứ và giờ tiếp nhận" style={{ minWidth: 880 }}>
        <div role="row" style={{ gridTemplateColumns: template }} className="mb-1 grid gap-[3px] text-xs font-semibold uppercase tracking-wide text-slate-600">
          <div role="columnheader" />
          {report.hours.map((h) => (
            <div key={h} role="columnheader" className="text-center">
              {h}h
            </div>
          ))}
          <div role="columnheader" className="text-right">
            Cộng
          </div>
        </div>
        {report.days.map((day) => (
          <div key={day.isoDow} role="row" style={{ gridTemplateColumns: template }} className="mb-[3px] grid items-center gap-[3px]">
            <div role="rowheader" className="font-semibold text-slate-700">
              {WEEKDAY_LABEL[day.isoDow]}
            </div>
            {day.counts.map((count, i) => (
              <div
                key={report.hours[i]}
                role="cell"
                title={`${WEEKDAY_LABEL[day.isoDow]} ${report.hours[i]}h: ${count} lượt`}
                style={heatCellStyle(count, max)}
                className="flex h-[42px] items-center justify-center rounded text-[13px] font-semibold tabular-nums"
              >
                {count}
              </div>
            ))}
            <div role="cell" className="text-right font-semibold tabular-nums text-slate-900">
              {formatCount(day.total)}
            </div>
          </div>
        ))}
        <div className="mt-3 flex items-center gap-2 text-[12.5px] text-slate-600" aria-hidden="true">
          <span>Ít</span>
          <span className="inline-block h-2.5 w-40 rounded-full" style={{ background: `linear-gradient(to right, ${heatCellStyle(0, 1).background}, ${heatCellStyle(1, 1).background})` }} />
          <span>Nhiều</span>
        </div>
      </div>
    </div>
  );
}

function Body({ report, period }: { report: PeakHoursReport; period: ReportPeriodState }) {
  const w = report.waiting;
  const maxDistribution = Math.max(0, ...w.distribution.map((d) => d.count));
  if (report.totalVisits === 0) {
    return <EmptyState icon={ChartBar} title="Không có lượt khám nào trong kỳ" description="Đổi kỳ hoặc phạm vi chi nhánh để xem giờ cao điểm." />;
  }
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu giờ cao điểm" />
      <ReportCard title="Lượt khám theo thứ và giờ tiếp nhận" hint={`${periodCaption(period.range)} · số lượt`}>
        <Heatmap report={report} />
      </ReportCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Chờ theo khung giờ">
          <ReportGridTable
            ariaLabel="Chờ theo khung giờ"
            columns={[{ header: 'Khung giờ', width: '110px' }, { header: 'Lượt', align: 'right', width: '80px' }, { header: 'Chờ TB', align: 'right', width: '100px' }, { header: 'Chờ > 30 phút', align: 'right', width: 'minmax(110px, 1fr)' }]}
            rows={w.slots.map((s) => [
              <span key="t" className="font-semibold">{s.label}</span>,
              formatCount(s.visits),
              <span key="w" className="font-semibold">{s.averageMinutes === null ? '—' : `${s.averageMinutes} phút`}</span>,
              <span key="o" className={s.over30Percent !== null && s.over30Percent >= 20 ? 'font-semibold text-rose-700' : 'text-slate-700'}>{formatPercent(s.over30Percent)}</span>,
            ])}
            emptyText="Chưa đo được thời gian chờ của lượt nào."
          />
        </ReportCard>
        <ReportCard title="Phân bố thời gian chờ" hint="Số lượt">
          {w.measuredCount === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-600">Chưa đo được thời gian chờ của lượt nào.</p>
          ) : (
            w.distribution.map((d, i) => (
              <div key={d.label} className="grid grid-cols-[100px_minmax(0,1fr)_120px] items-center gap-x-3 border-b border-slate-50 px-4 py-3 text-sm">
                <div className="font-medium text-slate-800">{d.label}</div>
                <div className="h-2.5 rounded-full bg-slate-100">
                  <div className={`h-2.5 rounded-full ${DISTRIBUTION_BAR_CLASS[i] ?? 'bg-slate-500'}`} style={{ width: `${barWidthPercent(d.count, maxDistribution)}%` }} />
                </div>
                <div className="text-right tabular-nums">
                  <span className="font-semibold text-slate-900">{formatCount(d.count)}</span> <span className="text-slate-600">({formatPercent(d.percent)})</span>
                </div>
              </div>
            ))
          )}
        </ReportCard>
      </div>
    </>
  );
}

/** Tab "Giờ cao điểm" (mockup đã duyệt): bản đồ nhiệt thứ × giờ, giờ cao điểm, chờ theo khung giờ và phân bố thời gian chờ. */
export function PeakHoursTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab period={period} scope={scope} exportKind="peak-hours" useReport={usePeakHoursQuery} buildPrint={buildPeakHoursPrintSpec} errorMessage="Không tải được báo cáo giờ cao điểm.">
      {(report) => <Body report={report} period={period} />}
    </PeriodReportTab>
  );
}
