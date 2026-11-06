import { Link } from 'react-router-dom';
import { Buildings } from '@phosphor-icons/react';
import type { SystemOverviewReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import { formatVndPlain } from '../../../shared/format/currency';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatCount, formatPercent } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import type { OperationsPeriodParams } from '../operations/operations.api';
import { BranchLineChart } from './BranchLineChart';
import { exportSystemExcel } from './system.api';
import { useSystemOverviewQuery } from './system.queries';
import { alertLink, describeKpiChange, SYSTEM_GROUP_COLOR, SYSTEM_GROUP_LABEL, SYSTEM_PERIOD_KINDS } from './system-model';
import { buildSystemOverviewPrintSpec } from './system-print-builders';

function kpis(report: SystemOverviewReport): ReportKpiItem[] {
  const k = report.kpis;
  const change = (kpi: SystemOverviewReport['kpis']['recognized']) => describeKpiChange(kpi, 'kỳ trước');
  const item = (label: string, kpi: SystemOverviewReport['kpis']['recognized'], tone: ReportKpiItem['tone'], format: (v: number) => string): ReportKpiItem => {
    const c = change(kpi);
    return { label, value: format(kpi.value), tone, sub: c.text, subTone: c.tone };
  };
  return [
    item('Ghi nhận', k.recognized, 'default', formatVndPlain),
    item('Thực thu', k.collected, 'green', formatVndPlain),
    item('Lượt khám', k.visits, 'default', formatCount),
    item('Bệnh nhân mới', k.newPatients, 'blue', formatCount),
    { label: 'Chờ thu', value: formatVndPlain(k.unpaidAmount), tone: 'amber', sub: `${formatCount(k.unpaidCount)} phiếu` },
  ];
}

function Body({ report, scope }: { report: SystemOverviewReport; scope: ReportScopeState }) {
  if (report.rows.length === 0) {
    return <EmptyState icon={Buildings} title="Không có chi nhánh nào trong phạm vi" description="Chọn lại phạm vi chi nhánh." />;
  }
  const multi = report.rows.length > 1;
  const t = report.totals;
  const maxGroup = Math.max(0, ...report.groups.map((g) => g.amount));
  return (
    <>
      <p className="text-[13px] text-slate-600">
        Đang xem: {report.rows.map((r) => r.branchName).join(', ')} · {formatDobDisplay(report.from)} – {formatDobDisplay(report.to)} · so với {formatDobDisplay(report.previousFrom)} – {formatDobDisplay(report.previousTo)}
      </p>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu toàn hệ thống" />
      <ReportCard title="So sánh chi nhánh" hint={multi && scope.canChoose ? 'Bấm tên chi nhánh để xem riêng' : undefined}>
        <ReportGridTable
          ariaLabel="So sánh chi nhánh"
          minWidth={1000}
          columns={[
            { header: 'Chi nhánh', width: 'minmax(150px, 1.3fr)' },
            { header: 'Lượt khám', align: 'right', width: 'minmax(80px, 1fr)' },
            { header: 'BN mới', align: 'right', width: 'minmax(70px, 1fr)' },
            { header: 'Ghi nhận', align: 'right', width: 'minmax(110px, 1fr)' },
            { header: 'Thực thu', align: 'right', width: 'minmax(110px, 1fr)' },
            { header: 'Chờ thu', align: 'right', width: 'minmax(100px, 1fr)' },
            { header: 'Chờ TB (phút)', align: 'right', width: 'minmax(90px, 1fr)' },
            { header: 'Tái khám đã đến', align: 'right', width: 'minmax(100px, 1fr)' },
            { header: 'Lãi gộp thuốc', align: 'right', width: 'minmax(110px, 1fr)' },
          ]}
          rows={report.rows.map((r) => [
            multi && scope.canChoose ? (
              <button key="n" type="button" onClick={() => scope.setBranchIds([r.branchId])} className="text-left font-semibold text-blue-700 hover:underline">
                {r.branchName}
              </button>
            ) : (
              <span key="n" className="font-semibold text-slate-900">{r.branchName}</span>
            ),
            formatCount(r.visits),
            formatCount(r.newPatients),
            <span key="rc" className="font-semibold text-slate-900">{formatVndPlain(r.recognized)}</span>,
            <span key="cl" className="font-semibold text-emerald-700">{formatVndPlain(r.collected)}</span>,
            <span key="up" className="font-semibold text-amber-700">{formatVndPlain(r.unpaidAmount)}</span>,
            r.averageWaitMinutes === null ? '—' : String(r.averageWaitMinutes),
            formatPercent(r.followUpArrivalPercent),
            <span key="dm" className="font-semibold text-teal-700">{formatVndPlain(r.drugMargin)}</span>,
          ])}
          footer={[
            `Cộng ${report.rows.length} chi nhánh`,
            formatCount(t.visits),
            formatCount(t.newPatients),
            formatVndPlain(t.recognized),
            formatVndPlain(t.collected),
            formatVndPlain(t.unpaidAmount),
            t.averageWaitMinutes === null ? '—' : String(t.averageWaitMinutes),
            formatPercent(t.followUpArrivalPercent),
            formatVndPlain(t.drugMargin),
          ]}
        />
      </ReportCard>
      <ReportCard title="Thực thu theo ngày, từng chi nhánh" hint="Triệu đồng">
        <BranchLineChart dates={report.daily.dates} series={report.daily.series} ariaLabel="Thực thu theo ngày của từng chi nhánh trong kỳ" />
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
        <ReportCard title="Cần chú ý" hint="Cập nhật theo kỳ đang chọn">
          {report.alerts.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-600">Không có việc cần chú ý.</p>
          ) : (
            report.alerts.map((a) => (
              <div key={`${a.kind}-${a.branchId}`} className="grid grid-cols-[110px_minmax(0,1fr)_56px] items-center gap-x-3 border-b border-slate-50 px-4 py-2.5 text-sm">
                <div className="font-semibold text-slate-900">{a.branchName}</div>
                <div className="text-slate-700">{a.text}</div>
                <Link to={alertLink(a.kind)} className="font-semibold text-blue-700 hover:underline">
                  Xem
                </Link>
              </div>
            ))
          )}
        </ReportCard>
      </div>
    </>
  );
}

/** Tab "So sánh chi nhánh": số liệu chính từng chi nhánh cạnh nhau, so với kỳ trước, thực thu theo ngày, cơ cấu theo nhóm và các việc cần chú ý. */
export function SystemOverviewTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<SystemOverviewReport, OperationsPeriodParams>
      period={period}
      scope={scope}
      kinds={SYSTEM_PERIOD_KINDS}
      exportFile={(p) => exportSystemExcel('overview', p)}
      useReport={useSystemOverviewQuery}
      buildPrint={buildSystemOverviewPrintSpec}
      errorMessage="Không tải được báo cáo toàn hệ thống."
    >
      {(report) => <Body report={report} scope={scope} />}
    </PeriodReportTab>
  );
}

