import { useMemo } from 'react';
import { Clock } from '@phosphor-icons/react';
import type { DoctorHoursReport } from '@nexamed/shared';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatCount, formatPercent } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { DOCTOR_PERIOD_KINDS } from './DoctorPerformanceTab';
import type { DoctorFilterState } from './DoctorDepartmentFilter';
import { exportDoctorExcel, type DoctorPeriodParams } from './doctors.api';
import { useDoctorHoursQuery } from './doctors.queries';
import { buildDoctorHoursPrintSpec } from './doctors-print-builders';
import { formatDecimal, formatDuration, formatHours, utilizationToneClass } from './doctors-model';

function kpis(report: DoctorHoursReport): ReportKpiItem[] {
  const t = report.totals;
  return [
    { label: 'Bác sĩ', value: formatCount(t.doctorCount), sub: 'đang hoạt động hoặc có khám' },
    { label: 'Giờ ca đã xếp', value: formatHours(t.scheduledMinutes), sub: `${formatCount(t.scheduledDays)} ngày có ca` },
    { label: 'Giờ khám thực tế', value: formatHours(t.consultMinutes), tone: 'blue', sub: `${formatCount(t.visits)} lượt khám` },
    { label: 'Tỉ lệ sử dụng', value: formatPercent(t.utilizationPercent), tone: 'green', sub: 'giờ khám trên giờ ca đã xếp' },
    { label: 'Nghỉ phép', value: `${formatCount(t.leaveDays)} ngày`, tone: 'amber', sub: 'đơn đã duyệt trong kỳ' },
  ];
}

function Body({ report }: { report: DoctorHoursReport }) {
  if (report.rows.length === 0) {
    return <EmptyState icon={Clock} title="Không có bác sĩ nào trong phạm vi" description="Chưa có bác sĩ đang hoạt động hay có lượt khám trong phạm vi và Khoa đã chọn. Đổi Khoa hoặc phạm vi chi nhánh." />;
  }
  const t = report.totals;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu giờ làm việc và lượt khám" />
      <ReportCard title="Theo bác sĩ" hint="Ca đã xếp theo Lịch làm việc, trừ giờ nghỉ giữa ca">
        <ReportGridTable
          ariaLabel="Giờ làm việc và lượt khám theo bác sĩ"
          minWidth={1100}
          columns={[
            { header: 'Bác sĩ', width: 'minmax(150px, 1.3fr)' },
            { header: 'Khoa', width: '100px' },
            { header: 'Ngày có ca', align: 'right', width: '80px' },
            { header: 'Giờ ca', align: 'right', width: '90px' },
            { header: 'Nghỉ phép', align: 'right', width: '84px' },
            { header: 'Ngày có khám', align: 'right', width: '84px' },
            { header: 'Lượt khám', align: 'right', width: '76px' },
            { header: 'Lượt / ngày', align: 'right', width: '84px' },
            { header: 'Giờ khám', align: 'right', width: '90px' },
            { header: 'Tỉ lệ sử dụng', width: 'minmax(130px, 1fr)' },
          ]}
          rows={report.rows.map((r) => [
            <span key="n" className="font-semibold text-slate-900">{r.doctorName}</span>,
            <span key="d" className="text-slate-700">{r.departmentName || '—'}</span>,
            formatCount(r.scheduledDays),
            formatDuration(r.scheduledMinutes),
            <span key="l" className={r.leaveDays > 0 ? 'text-amber-700' : 'text-slate-600'}>{formatCount(r.leaveDays)} ngày</span>,
            formatCount(r.activeDays),
            <span key="v" className="font-semibold">{formatCount(r.visits)}</span>,
            formatDecimal(r.visitsPerActiveDay),
            formatDuration(r.consultMinutes),
            <div key="u" className="grid grid-cols-[minmax(0,1fr)_56px] items-center gap-x-2">
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-teal-700" style={{ width: `${barWidthPercent(r.utilizationPercent ?? 0, 100)}%` }} />
              </div>
              <span className={`text-right tabular-nums ${utilizationToneClass(r.utilizationPercent)}`}>{formatPercent(r.utilizationPercent)}</span>
            </div>,
          ])}
          footer={[`Cộng ${t.doctorCount} bác sĩ`, '', formatCount(t.scheduledDays), formatDuration(t.scheduledMinutes), `${formatCount(t.leaveDays)} ngày`, formatCount(t.activeDays), formatCount(t.visits), '', formatDuration(t.consultMinutes), formatPercent(t.utilizationPercent)]}
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
    </>
  );
}

/** Tab "Giờ làm việc và lượt khám": ca đã xếp, nghỉ phép đã duyệt và lượt/giờ khám thực tế của từng bác sĩ, kèm tỉ lệ sử dụng giờ ca. */
export function DoctorHoursTab({ period, scope, filter }: { period: ReportPeriodState; scope: ReportScopeState; filter: DoctorFilterState }) {
  const extraParams = useMemo(() => ({ departmentId: filter.departmentId || undefined }), [filter.departmentId]);
  return (
    <PeriodReportTab<DoctorHoursReport, DoctorPeriodParams>
      period={period}
      scope={scope}
      kinds={DOCTOR_PERIOD_KINDS}
      controls={filter.control}
      extraParams={extraParams}
      exportFile={(p) => exportDoctorExcel('hours', p)}
      useReport={useDoctorHoursQuery}
      buildPrint={(report, ctx) => buildDoctorHoursPrintSpec(report, { ...ctx, departmentLabel: filter.departmentLabel })}
      errorMessage="Không tải được báo cáo giờ làm việc và lượt khám."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
