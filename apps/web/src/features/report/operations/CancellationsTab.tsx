import { CalendarX } from '@phosphor-icons/react';
import type { CancellationReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { formatCount, formatPercent } from './operations-model';
import { buildCancellationPrintSpec } from './operations-print-builders';
import { useCancellationsQuery } from './operations.queries';
import { PeriodReportTab } from './PeriodReportTab';

const share = (part: number, whole: number): string => (whole > 0 ? `${formatPercent(Math.round((part / whole) * 1000) / 10)} trên ${formatCount(whole)}` : 'chưa có');

function kpis(report: CancellationReport): ReportKpiItem[] {
  const e = report.encounters;
  const a = report.appointments;
  return [
    { label: 'Lượt khám đã huỷ', value: formatCount(e.cancelled), tone: 'rose', sub: `${share(e.cancelled, e.total)} lượt khám` },
    { label: 'Lượt khám không đến', value: formatCount(e.noShow), tone: 'amber', sub: `${share(e.noShow, e.total)} lượt khám` },
    { label: 'Lịch hẹn đã huỷ', value: formatCount(a.cancelled), tone: 'rose', sub: `${share(a.cancelled, a.total)} lịch hẹn` },
    { label: 'Lịch hẹn không đến', value: formatCount(a.noShow), tone: 'amber', sub: `${share(a.noShow, a.total)} lịch hẹn` },
  ];
}

const COUNT_COLUMNS = [
  { header: 'Khám huỷ', align: 'right' as const },
  { header: 'Khám không đến', align: 'right' as const },
  { header: 'Hẹn huỷ', align: 'right' as const },
  { header: 'Hẹn không đến', align: 'right' as const },
];

function Body({ report }: { report: CancellationReport }) {
  const e = report.encounters;
  const a = report.appointments;
  if (e.cancelled + e.noShow + a.cancelled + a.noShow + a.rescheduled === 0) {
    return <EmptyState icon={CalendarX} title="Không có lượt huỷ hay không đến nào trong kỳ" description="Đổi kỳ hoặc phạm vi chi nhánh để xem số khác." />;
  }
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu huỷ và không đến" />
      <>
        <ReportCard title="Lý do huỷ" hint={a.rescheduled > 0 ? `${formatCount(a.rescheduled)} lịch hẹn được dời` : undefined}>
          <ReportGridTable
            ariaLabel="Lý do huỷ"
            columns={[{ header: 'Lý do', width: 'minmax(200px, 3fr)' }, { header: 'Lượt khám huỷ', align: 'right' }, { header: 'Lịch hẹn huỷ', align: 'right' }]}
            rows={report.reasons.map((r) => [
              r.reason === '' ? <span key="r" className="text-slate-600">Không ghi lý do</span> : <span key="r" className="font-semibold text-slate-900">{r.reason}</span>,
              formatCount(r.encounterCount),
              formatCount(r.appointmentCount),
            ])}
            emptyText="Không có lượt khám hoặc lịch hẹn nào bị huỷ."
            maxBodyHeightClass="max-h-[420px]"
          />
        </ReportCard>
        <ReportCard title="Theo bác sĩ">
          <ReportGridTable
            ariaLabel="Huỷ và không đến theo bác sĩ"
            minWidth={640}
            columns={[{ header: 'Bác sĩ', width: 'minmax(160px, 2fr)' }, ...COUNT_COLUMNS]}
            rows={report.byDoctor.map((d) => [
              <span key="n" className="font-semibold text-slate-900">{d.doctorName}</span>,
              formatCount(d.encounterCancelled),
              formatCount(d.encounterNoShow),
              formatCount(d.appointmentCancelled),
              formatCount(d.appointmentNoShow),
            ])}
            emptyText="Không có trường hợp nào."
            maxBodyHeightClass="max-h-[420px]"
          />
        </ReportCard>
      </>
      <ReportCard title="Theo ngày" hint="Ngày tiếp nhận (lượt khám) và ngày hẹn (lịch hẹn)">
        <ReportGridTable
          ariaLabel="Huỷ và không đến theo ngày"
          minWidth={640}
          columns={[{ header: 'Ngày', width: 'minmax(110px, 2fr)' }, ...COUNT_COLUMNS]}
          rows={report.byDay.map((d) => [
            <span key="d" className="font-semibold">{formatDobDisplay(d.date)}</span>,
            formatCount(d.encounterCancelled),
            formatCount(d.encounterNoShow),
            formatCount(d.appointmentCancelled),
            formatCount(d.appointmentNoShow),
          ])}
          emptyText="Không có trường hợp nào."
          maxBodyHeightClass="max-h-[420px]"
        />
      </ReportCard>
    </>
  );
}

/** Tab "Huỷ và không đến": lượt khám và lịch hẹn tách riêng, lý do huỷ, theo bác sĩ và theo ngày. */
export function CancellationsTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab period={period} scope={scope} exportKind="cancellations" useReport={useCancellationsQuery} buildPrint={buildCancellationPrintSpec} errorMessage="Không tải được báo cáo huỷ và không đến.">
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
