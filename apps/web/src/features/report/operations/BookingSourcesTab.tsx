import { Phone } from '@phosphor-icons/react';
import type { BookingSourceReport } from '@nexamed/shared';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import { APPOINTMENT_SOURCE_LABEL } from '../../appointment/appointment-status';
import type { ReportScopeState } from '../../branch/useReportScope';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { barWidthPercent, formatCount, formatPercent, sourceLabel } from './operations-model';
import { buildBookingSourcePrintSpec } from './operations-print-builders';
import { useBookingSourcesQuery } from './operations.queries';
import { PeriodReportTab } from './PeriodReportTab';

const label = (source: string) => sourceLabel(source, APPOINTMENT_SOURCE_LABEL);

function kpis(report: BookingSourceReport): ReportKpiItem[] {
  return [
    { label: 'Lịch hẹn trong kỳ', value: formatCount(report.total), sub: 'theo ngày hẹn' },
    { label: 'Đã đến', value: formatCount(report.arrived), tone: 'green', sub: 'đã tiếp nhận thành lượt khám' },
    { label: 'Tỉ lệ đến', value: formatPercent(report.arrivalPercent), tone: 'blue', sub: 'đã đến trên tổng lịch hẹn' },
    { label: 'Nguồn nhiều nhất', value: report.topSource ? label(report.topSource) : '—', sub: report.topSource ? 'theo số lịch hẹn' : 'chưa có lịch hẹn' },
  ];
}

function Body({ report }: { report: BookingSourceReport }) {
  if (report.total === 0) {
    return <EmptyState icon={Phone} title="Không có lịch hẹn nào trong kỳ" description="Đổi kỳ hoặc phạm vi chi nhánh để xem nguồn đặt lịch." />;
  }
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu nguồn đặt lịch" />
      <ReportCard title="Theo nguồn đặt lịch" hint="Xếp theo số lịch hẹn">
        <ReportGridTable
          ariaLabel="Lịch hẹn theo nguồn đặt"
          minWidth={760}
          columns={[
            { header: 'Nguồn đặt lịch', width: 'minmax(140px, 1.2fr)' },
            { header: 'Lịch hẹn', align: 'right', width: '90px' },
            { header: 'Đã đến', align: 'right', width: '80px' },
            { header: 'Còn chờ', align: 'right', width: '80px' },
            { header: 'Huỷ', align: 'right', width: '70px' },
            { header: 'Không đến', align: 'right', width: '90px' },
            { header: 'Dời lịch', align: 'right', width: '80px' },
            { header: 'Tỉ lệ đến', width: 'minmax(150px, 1fr)' },
          ]}
          rows={report.sources.map((s) => [
            <span key="n" className="font-semibold text-slate-900">{label(s.source)}</span>,
            <span key="t" className="font-semibold">{formatCount(s.total)}</span>,
            <span key="a" className="text-emerald-700">{formatCount(s.arrived)}</span>,
            formatCount(s.pending),
            <span key="c" className={s.cancelled > 0 ? 'text-rose-700' : undefined}>{formatCount(s.cancelled)}</span>,
            <span key="x" className={s.noShow > 0 ? 'text-amber-700' : undefined}>{formatCount(s.noShow)}</span>,
            formatCount(s.rescheduled),
            <div key="p" className="grid grid-cols-[minmax(0,1fr)_56px] items-center gap-x-2">
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-teal-700" style={{ width: `${barWidthPercent(s.arrivalPercent ?? 0, 100)}%` }} />
              </div>
              <span className="text-right font-semibold tabular-nums">{formatPercent(s.arrivalPercent)}</span>
            </div>,
          ])}
          footer={['Cộng', formatCount(report.total), formatCount(report.arrived), formatCount(report.sources.reduce((x, s) => x + s.pending, 0)), formatCount(report.sources.reduce((x, s) => x + s.cancelled, 0)), formatCount(report.sources.reduce((x, s) => x + s.noShow, 0)), formatCount(report.sources.reduce((x, s) => x + s.rescheduled, 0)), formatPercent(report.arrivalPercent)]}
        />
      </ReportCard>
    </>
  );
}

/** Tab "Nguồn đặt lịch": lịch hẹn trong kỳ theo nguồn (điện thoại, online, walk-in) — đã đến, huỷ, không đến, dời, tỉ lệ đến. */
export function BookingSourcesTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab period={period} scope={scope} exportKind="booking-sources" useReport={useBookingSourcesQuery} buildPrint={buildBookingSourcePrintSpec} errorMessage="Không tải được báo cáo nguồn đặt lịch.">
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
