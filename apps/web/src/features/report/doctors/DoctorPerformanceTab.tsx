import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope } from '@phosphor-icons/react';
import type { DoctorPerformanceReport } from '@nexamed/shared';
import { formatVndPlain } from '../../../shared/format/currency';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatCount } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import { periodCaption, type PeriodKind } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import type { DoctorFilterState } from './DoctorDepartmentFilter';
import { exportDoctorExcel, type DoctorPeriodParams } from './doctors.api';
import { useDoctorPerformanceQuery } from './doctors.queries';
import { buildDoctorPerformancePrintSpec } from './doctors-print-builders';
import { doctorCardTitle, doctorVisitBookLink, formatWholePercent } from './doctors-model';

/** Kỳ của các tab Bác sĩ (đúng mockup): 7 ngày, Tháng này, Tháng trước, Quý, Tuỳ chọn. */
export const DOCTOR_PERIOD_KINDS: readonly PeriodKind[] = ['last7', 'thisMonth', 'lastMonth', 'quarter', 'custom'];

function kpis(report: DoctorPerformanceReport): ReportKpiItem[] {
  const t = report.totals;
  return [
    { label: 'Bác sĩ có khám', value: formatCount(t.doctorCount), sub: report.branchCount > 1 ? `trong ${report.branchCount} chi nhánh` : 'trong chi nhánh' },
    { label: 'Lượt khám mỗi bác sĩ', value: t.visitsPerDoctor === null ? '—' : formatCount(t.visitsPerDoctor), sub: 'trung bình' },
    { label: 'Thời gian khám', value: t.avgMinutes === null ? '—' : `${t.avgMinutes} phút`, tone: 'blue', sub: 'trung bình một lượt' },
    { label: 'Doanh thu một lượt', value: t.revenuePerVisit === null ? '—' : formatVndPlain(t.revenuePerVisit), tone: 'green', sub: 'ghi nhận chia số lượt' },
    { label: 'Có chỉ định cận lâm sàng', value: formatWholePercent(t.clsPercent), tone: 'teal', sub: 'trên số lượt khám' },
  ];
}

function Body({ report, from, to }: { report: DoctorPerformanceReport; from: string; to: string }) {
  if (report.rows.length === 0) {
    return <EmptyState icon={Stethoscope} title="Không có bác sĩ nào khám trong kỳ" description="Chưa có lượt khám đã hoàn tất nào của bác sĩ trong kỳ đã chọn. Đổi kỳ, Khoa hoặc phạm vi chi nhánh." />;
  }
  const t = report.totals;
  const max = Math.max(0, ...report.rows.map((r) => r.revenue));
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu hiệu suất bác sĩ" />
      <ReportCard title={doctorCardTitle(periodCaption({ from, to }))} hint="Xếp theo doanh thu sinh ra">
        <ReportGridTable
          ariaLabel="Hiệu suất theo bác sĩ"
          minWidth={1100}
          columns={[
            { header: '#', width: '40px' },
            { header: 'Bác sĩ', width: 'minmax(150px, 1.2fr)' },
            { header: 'Khoa', width: '100px' },
            { header: 'Lượt khám', align: 'right', width: '76px' },
            { header: 'Phút / lượt', align: 'right', width: '84px' },
            { header: 'Doanh thu sinh ra ▼', width: 'minmax(180px, 1.4fr)' },
            { header: 'Một lượt', align: 'right', width: '86px' },
            { header: 'Có CLS', align: 'right', width: '66px' },
            { header: 'Có thuốc', align: 'right', width: '74px' },
            { header: 'Hẹn tái khám', align: 'right', width: '100px' },
            { header: '', width: '44px' },
          ]}
          rows={report.rows.map((r) => [
            <span key="rk" className="font-semibold text-slate-700">{r.rank}</span>,
            <span key="n" className="font-semibold text-slate-900">{r.doctorName}</span>,
            <span key="d" className="text-slate-700">{r.departmentName || '—'}</span>,
            <span key="v" className="font-semibold">{formatCount(r.visits)}</span>,
            r.avgMinutes === null ? '—' : String(r.avgMinutes),
            <div key="rv" className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-x-2.5">
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-emerald-700" style={{ width: `${barWidthPercent(r.revenue, max)}%` }} />
              </div>
              <span className="text-right font-semibold tabular-nums text-emerald-700">{formatVndPlain(r.revenue)}</span>
            </div>,
            r.revenuePerVisit === null ? '—' : formatVndPlain(r.revenuePerVisit),
            formatWholePercent(r.clsPercent),
            formatWholePercent(r.drugPercent),
            formatWholePercent(r.followUpPercent),
            <Link key="x" to={doctorVisitBookLink(r.doctorId, from, to)} className="text-sm font-semibold text-blue-700 hover:underline">
              Xem
            </Link>,
          ])}
          footer={[
            '',
            `Cộng ${t.doctorCount} bác sĩ`,
            '',
            formatCount(t.visits),
            t.avgMinutes === null ? '—' : String(t.avgMinutes),
            formatVndPlain(t.revenue),
            t.revenuePerVisit === null ? '—' : formatVndPlain(t.revenuePerVisit),
            formatWholePercent(t.clsPercent),
            formatWholePercent(t.drugPercent),
            formatWholePercent(t.followUpPercent),
            '',
          ]}
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
    </>
  );
}

/** Tab "Hiệu suất theo bác sĩ": lượt khám, thời gian khám, doanh thu sinh ra và tỉ lệ có cận lâm sàng/thuốc/hẹn tái khám của từng bác sĩ. */
export function DoctorPerformanceTab({ period, scope, filter }: { period: ReportPeriodState; scope: ReportScopeState; filter: DoctorFilterState }) {
  const extraParams = useMemo(() => ({ departmentId: filter.departmentId || undefined }), [filter.departmentId]);
  return (
    <PeriodReportTab<DoctorPerformanceReport, DoctorPeriodParams>
      period={period}
      scope={scope}
      kinds={DOCTOR_PERIOD_KINDS}
      controls={filter.control}
      extraParams={extraParams}
      exportFile={(p) => exportDoctorExcel('performance', p)}
      useReport={useDoctorPerformanceQuery}
      buildPrint={(report, ctx) => buildDoctorPerformancePrintSpec(report, { ...ctx, departmentLabel: filter.departmentLabel })}
      errorMessage="Không tải được báo cáo hiệu suất bác sĩ."
    >
      {(report) => <Body report={report} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}
