import { useMemo } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';
import type { SystemMonthlyReport } from '@nexamed/shared';
import { formatVndPlain } from '../../../shared/format/currency';
import { Combobox } from '../../../shared/ui/Combobox';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatCount } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import { exportSystemExcel, type SystemMonthlyParams } from './system.api';
import { useSystemMonthlyQuery } from './system.queries';
import { changePercent, changeToneClass, describeKpiChange, formatSignedPercent, monthLabel, monthOptions, monthPeriodState, monthShort, SYSTEM_GROUP_COLOR, SYSTEM_GROUP_LABEL } from './system-model';
import { buildSystemMonthlyPrintSpec } from './system-print-builders';

function kpis(report: SystemMonthlyReport): ReportKpiItem[] {
  const k = report.kpis;
  const previousLabel = monthLabel(report.previousMonth).toLowerCase();
  const item = (label: string, kpi: SystemMonthlyReport['kpis']['recognized'], tone: ReportKpiItem['tone'], format: (v: number) => string): ReportKpiItem => {
    const c = describeKpiChange(kpi, previousLabel);
    return { label, value: format(kpi.value), tone, sub: c.text, subTone: c.tone };
  };
  return [
    item('Ghi nhận', k.recognized, 'default', formatVndPlain),
    item('Thực thu', k.collected, 'green', formatVndPlain),
    item('Lượt khám', k.visits, 'default', formatCount),
    item('Bệnh nhân mới', k.newPatients, 'blue', formatCount),
    item('Lãi gộp thuốc', k.drugMargin, 'teal', formatVndPlain),
  ];
}

function Body({ report }: { report: SystemMonthlyReport }) {
  if (report.rows.length === 0) return <EmptyState icon={CalendarBlank} title="Không có chi nhánh nào trong phạm vi" description="Chọn lại phạm vi chi nhánh." />;
  const sum = (key: 'visits' | 'newPatients' | 'recognized' | 'collected' | 'drugMargin', which: 'current' | 'previous') => report.rows.reduce((s, r) => s + r[which][key], 0);
  const maxGroup = Math.max(0, ...report.groups.map((g) => g.amount));
  const maxTrend = Math.max(0, ...report.trend.map((m) => m.collected));
  const totalChange = changePercent(sum('collected', 'current'), sum('collected', 'previous'));
  return (
    <>
      <p className="text-[13px] text-slate-600">
        {monthLabel(report.month)} · so với {monthLabel(report.previousMonth).toLowerCase()} · {report.rows.map((r) => r.branchName).join(', ')}
      </p>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu tổng hợp tháng" />
      <ReportCard title={`Theo chi nhánh, ${monthLabel(report.month).toLowerCase()}`}>
        <ReportGridTable
          ariaLabel="Tổng hợp tháng theo chi nhánh"
          minWidth={1000}
          columns={[
            { header: 'Chi nhánh', width: 'minmax(150px, 1.3fr)' },
            { header: 'Lượt khám', align: 'right', width: 'minmax(80px, 1fr)' },
            { header: 'BN mới', align: 'right', width: 'minmax(70px, 1fr)' },
            { header: 'Ghi nhận', align: 'right', width: 'minmax(110px, 1fr)' },
            { header: 'Thực thu', align: 'right', width: 'minmax(110px, 1fr)' },
            { header: `Thực thu ${monthShort(report.previousMonth)}`, align: 'right', width: 'minmax(120px, 1fr)' },
            { header: 'So tháng trước', align: 'right', width: 'minmax(100px, 1fr)' },
            { header: 'Lãi gộp thuốc', align: 'right', width: 'minmax(110px, 1fr)' },
          ]}
          rows={report.rows.map((r) => {
            const change = changePercent(r.current.collected, r.previous.collected);
            return [
              <span key="n" className="font-semibold text-slate-900">{r.branchName}</span>,
              formatCount(r.current.visits),
              formatCount(r.current.newPatients),
              <span key="rc" className="font-semibold text-slate-900">{formatVndPlain(r.current.recognized)}</span>,
              <span key="cl" className="font-semibold text-emerald-700">{formatVndPlain(r.current.collected)}</span>,
              <span key="pv" className="text-slate-600">{formatVndPlain(r.previous.collected)}</span>,
              <span key="ch" className={`font-semibold ${changeToneClass(change)}`}>{formatSignedPercent(change)}</span>,
              <span key="dm" className="font-semibold text-teal-700">{formatVndPlain(r.current.drugMargin)}</span>,
            ];
          })}
          footer={[
            `Cộng ${report.rows.length} chi nhánh`,
            formatCount(sum('visits', 'current')),
            formatCount(sum('newPatients', 'current')),
            formatVndPlain(sum('recognized', 'current')),
            formatVndPlain(sum('collected', 'current')),
            formatVndPlain(sum('collected', 'previous')),
            formatSignedPercent(totalChange),
            formatVndPlain(sum('drugMargin', 'current')),
          ]}
        />
      </ReportCard>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportCard title="Cơ cấu thực thu theo nhóm" hint={formatVndPlain(report.groupTotal)}>
          {report.groups.map((g) => (
            <div key={g.group} className="grid grid-cols-[130px_minmax(0,1fr)_120px] items-center gap-x-3 border-b border-slate-50 px-4 py-2.5 text-sm">
              <div className="font-semibold text-slate-800">{SYSTEM_GROUP_LABEL[g.group]}</div>
              <div className="h-2.5 rounded-full bg-slate-100">
                <div className="h-2.5 rounded-full" style={{ width: `${barWidthPercent(g.amount, maxGroup)}%`, background: SYSTEM_GROUP_COLOR[g.group] }} />
              </div>
              <div className="text-right font-semibold tabular-nums text-slate-900">{formatVndPlain(g.amount)}</div>
            </div>
          ))}
        </ReportCard>
        <ReportCard title={`Xu hướng ${report.trend.length} tháng gần nhất`} hint="Toàn phạm vi">
          <ReportGridTable
            ariaLabel="Xu hướng các tháng gần nhất"
            minWidth={560}
            columns={[
              { header: 'Tháng', width: '70px' },
              { header: 'Lượt khám', align: 'right', width: '84px' },
              { header: 'BN mới', align: 'right', width: '70px' },
              { header: 'Thực thu', width: 'minmax(180px, 1fr)' },
            ]}
            rows={report.trend.map((m) => [
              <span key="m" className={m.month === report.month ? 'font-semibold text-slate-900' : 'text-slate-700'}>{monthShort(m.month)}</span>,
              formatCount(m.visits),
              formatCount(m.newPatients),
              <div key="c" className="grid grid-cols-[minmax(0,1fr)_104px] items-center gap-x-2.5">
                <div className="h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-emerald-700" style={{ width: `${barWidthPercent(m.collected, maxTrend)}%` }} />
                </div>
                <span className="text-right font-semibold tabular-nums text-emerald-700">{formatVndPlain(m.collected)}</span>
              </div>,
            ])}
          />
        </ReportCard>
      </div>
    </>
  );
}

/** Tab "Tổng hợp tháng": số liệu một tháng của toàn phạm vi so với tháng trước, theo chi nhánh, cơ cấu theo nhóm và xu hướng — dùng để gửi chủ đầu tư. */
export function SystemMonthlyTab({ scope, month, onMonthChange, today }: { scope: ReportScopeState; month: string; onMonthChange: (next: string) => void; today: string }) {
  const period = useMemo(() => monthPeriodState(month, today), [month, today]);
  const options = useMemo(() => monthOptions(today, 24), [today]);
  const extraParams = useMemo(() => ({ month }), [month]);
  const control = (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="system-report-month" className="text-sm font-semibold text-slate-800">
        Tháng
      </label>
      <div className="w-[170px]">
        <Combobox id="system-report-month" value={month} options={options} onChange={onMonthChange} placeholder="Chọn tháng" />
      </div>
    </div>
  );
  return (
    <PeriodReportTab<SystemMonthlyReport, SystemMonthlyParams>
      period={period}
      scope={scope}
      periodControl={control}
      extraParams={extraParams}
      exportFile={(p) => exportSystemExcel('monthly', p)}
      useReport={useSystemMonthlyQuery}
      buildPrint={buildSystemMonthlyPrintSpec}
      errorMessage="Không tải được báo cáo tổng hợp tháng."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
