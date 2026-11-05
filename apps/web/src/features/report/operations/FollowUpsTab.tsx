import { CalendarCheck } from '@phosphor-icons/react';
import type { FollowUpReminderResultKind, FollowUpReport } from '@nexamed/shared';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { FOLLOW_UP_REMINDER_RESULT_LABEL } from '../../follow-up/follow-up-model';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { barWidthPercent, formatCount, formatPercent } from './operations-model';
import { buildFollowUpPrintSpec } from './operations-print-builders';
import { useFollowUpsReportQuery } from './operations.queries';
import { PeriodReportTab } from './PeriodReportTab';

function kpis(report: FollowUpReport): ReportKpiItem[] {
  const s = report.summary;
  return [
    { label: 'Hẹn tái khám trong kỳ', value: formatCount(s.total), sub: s.notReturning > 0 ? `${formatCount(s.notReturning)} bệnh nhân không tái khám (chưa tính)` : 'theo ngày hẹn' },
    { label: 'Đã đến', value: formatCount(s.arrived), tone: 'green', sub: 'đã có lượt khám sau lượt gốc' },
    { label: 'Quá hạn chưa đến', value: formatCount(s.overdue), tone: 'rose', sub: 'ngày hẹn đã qua' },
    { label: 'Còn chờ', value: formatCount(s.pending), tone: 'amber', sub: 'ngày hẹn hôm nay hoặc chưa tới' },
    { label: 'Tỉ lệ đến', value: formatPercent(s.arrivalPercent), tone: 'blue', sub: 'đã đến trên hẹn đã đến hạn' },
  ];
}

function Body({ report }: { report: FollowUpReport }) {
  const s = report.summary;
  if (s.total + s.notReturning === 0 && report.reminders.length === 0) {
    return <EmptyState icon={CalendarCheck} title="Không có hẹn tái khám nào trong kỳ" description="Hẹn tái khám lấy từ kế hoạch điều trị đã ký của bác sĩ. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const maxTotal = Math.max(0, ...report.byDoctor.map((d) => d.total));
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu tái khám" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ReportCard title="Theo bác sĩ" hint="Bác sĩ của lượt khám gốc">
          <ReportGridTable
            ariaLabel="Tái khám theo bác sĩ"
            minWidth={620}
            columns={[
              { header: 'Bác sĩ', width: 'minmax(140px, 1.3fr)' },
              { header: 'Hẹn', align: 'right', width: 'minmax(110px, 1fr)' },
              { header: 'Đã đến', align: 'right', width: '70px' },
              { header: 'Quá hạn', align: 'right', width: '80px' },
              { header: 'Còn chờ', align: 'right', width: '80px' },
              { header: 'Tỉ lệ đến', align: 'right', width: '80px' },
            ]}
            rows={report.byDoctor.map((d) => [
              <span key="n" className="font-semibold text-slate-900">{d.doctorName}</span>,
              <div key="b" className="flex items-center justify-end gap-2">
                <div className="h-2 w-16 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-blue-700" style={{ width: `${barWidthPercent(d.total, maxTotal)}%` }} />
                </div>
                <span className="w-8 text-right font-semibold">{formatCount(d.total)}</span>
              </div>,
              <span key="a" className="text-emerald-700">{formatCount(d.arrived)}</span>,
              <span key="o" className={d.overdue > 0 ? 'text-rose-700' : undefined}>{formatCount(d.overdue)}</span>,
              formatCount(d.pending),
              <span key="p" className="font-semibold">{formatPercent(d.arrivalPercent)}</span>,
            ])}
            emptyText="Không có hẹn tái khám nào trong kỳ."
            maxBodyHeightClass="max-h-[480px]"
          />
        </ReportCard>
        <ReportCard title="Các lần nhắc trong kỳ" hint="Lễ tân ghi ở trang Hẹn tái khám">
          <ReportGridTable
            ariaLabel="Các lần nhắc tái khám theo kết quả"
            columns={[{ header: 'Kết quả nhắc', width: 'minmax(140px, 1fr)' }, { header: 'Số lần', align: 'right', width: '80px' }]}
            rows={report.reminders.map((r) => [FOLLOW_UP_REMINDER_RESULT_LABEL[r.result as FollowUpReminderResultKind] ?? r.result, <span key="c" className="font-semibold">{formatCount(r.count)}</span>])}
            emptyText="Không có lần nhắc nào trong kỳ."
          />
        </ReportCard>
      </div>
    </>
  );
}

/** Tab "Tái khám": đã hẹn, đã đến, quá hạn chưa đến, còn chờ, bệnh nhân không tái khám; theo bác sĩ; các lần nhắc theo kết quả. */
export function FollowUpsTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab period={period} scope={scope} exportKind="follow-ups" useReport={useFollowUpsReportQuery} buildPrint={buildFollowUpPrintSpec} errorMessage="Không tải được báo cáo tái khám.">
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
