import { UsersThree } from '@phosphor-icons/react';
import type { PatientFrequencyBucket, PatientNewReturningReport } from '@nexamed/shared';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatCount, formatPercent } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { PeriodKind } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportPatientExcel, type PatientPeriodParams } from './patients.api';
import { usePatientNewReturningQuery } from './patients.queries';
import { buildPatientNewReturningPrintSpec } from './patients-print-builders';
import { formatDecimal, formatMonth, shareOf } from './patients-model';

/** Kỳ của các tab Bệnh nhân: 7 ngày, Tháng này, Tháng trước, Quý, Tuỳ chọn (cùng nhóm Bác sĩ). */
export const PATIENT_PERIOD_KINDS: readonly PeriodKind[] = ['last7', 'thisMonth', 'lastMonth', 'quarter', 'custom'];

function kpis(report: PatientNewReturningReport): ReportKpiItem[] {
  const s = report.summary;
  return [
    { label: 'Bệnh nhân có khám', value: formatCount(s.patients), sub: `${formatCount(s.visits)} lượt khám` },
    { label: 'Bệnh nhân mới', value: formatCount(s.newPatients), tone: 'blue', sub: formatPercent(shareOf(s.newPatients, s.patients)) + ' tổng số' },
    { label: 'Bệnh nhân cũ', value: formatCount(s.returningPatients), tone: 'teal', sub: formatPercent(s.returningPercent) + ' tổng số' },
    { label: 'Lượt mỗi bệnh nhân', value: formatDecimal(s.visitsPerPatient), sub: 'trung bình trong kỳ' },
  ];
}

function BucketCard({ title, hint, label, items, total, color }: { title: string; hint: string; label: string; items: readonly PatientFrequencyBucket[]; total: number; color: string }) {
  const max = Math.max(0, ...items.map((i) => i.patients));
  return (
    <ReportCard title={title} hint={hint}>
      <ReportGridTable
        ariaLabel={title}
        columns={[{ header: label, width: 'minmax(110px, 1fr)' }, { header: 'Bệnh nhân', align: 'right', width: '84px' }, { header: 'Tỉ lệ', align: 'right', width: '64px' }, { header: '', width: 'minmax(70px, 0.8fr)' }]}
        rows={items.map((i) => [
          <span key="l" className="font-semibold text-slate-900">{i.label}</span>,
          formatCount(i.patients),
          formatPercent(shareOf(i.patients, total)),
          <div key="b" className="h-2 rounded-full bg-slate-100">
            <div className={`h-2 rounded-full ${color}`} style={{ width: `${barWidthPercent(i.patients, max)}%` }} />
          </div>,
        ])}
      />
    </ReportCard>
  );
}

function Body({ report }: { report: PatientNewReturningReport }) {
  const s = report.summary;
  if (s.patients === 0) {
    return <EmptyState icon={UsersThree} title="Không có lượt khám nào trong kỳ" description="Chưa có bệnh nhân nào được tiếp nhận trong kỳ đã chọn. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const maxMonth = Math.max(0, ...report.byMonth.map((m) => m.patients));
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu bệnh nhân mới và cũ" />
      <ReportCard title="Theo tháng" hint="Bệnh nhân khác nhau có khám trong tháng">
        <ReportGridTable
          ariaLabel="Bệnh nhân mới và cũ theo tháng"
          minWidth={720}
          columns={[
            { header: 'Tháng', width: '90px' },
            { header: 'Có khám', align: 'right', width: '84px' },
            { header: 'Mới', align: 'right', width: '70px' },
            { header: 'Cũ', align: 'right', width: '70px' },
            { header: 'Lượt khám', align: 'right', width: '90px' },
            { header: 'Mới / cũ', width: 'minmax(160px, 1fr)' },
          ]}
          rows={report.byMonth.map((m) => [
            <span key="m" className="font-semibold text-slate-900">{formatMonth(m.month)}</span>,
            <span key="p" className="font-semibold">{formatCount(m.patients)}</span>,
            <span key="n" className="text-blue-700">{formatCount(m.newPatients)}</span>,
            <span key="r" className="text-teal-700">{formatCount(m.returningPatients)}</span>,
            formatCount(m.visits),
            <div key="b" className="flex h-2 overflow-hidden rounded-full bg-slate-100" style={{ width: `${barWidthPercent(m.patients, maxMonth)}%` }}>
              <div className="h-2 bg-blue-600" style={{ width: `${barWidthPercent(m.newPatients, m.patients)}%` }} />
              <div className="h-2 bg-teal-600" style={{ width: `${barWidthPercent(m.returningPatients, m.patients)}%` }} />
            </div>,
          ])}
          footer={['Cộng', '', formatCount(s.newPatients), formatCount(s.returningPatients), formatCount(s.visits), '']}
          maxBodyHeightClass="max-h-[420px]"
        />
      </ReportCard>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <BucketCard title="Số lượt khám của mỗi bệnh nhân" hint="Trong kỳ đã chọn" label="Số lượt" items={report.frequency} total={s.patients} color="bg-blue-600" />
        <BucketCard title="Bệnh nhân cũ quay lại sau" hint="Từ lượt khám liền trước" label="Khoảng" items={report.gap} total={s.returningPatients} color="bg-teal-600" />
      </div>
    </>
  );
}

/** Tab "Bệnh nhân mới và cũ": số bệnh nhân có khám, mới/cũ trên toàn công ty, số lượt mỗi bệnh nhân, khoảng thời gian quay lại, theo tháng. */
export function PatientNewReturningTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<PatientNewReturningReport, PatientPeriodParams>
      period={period}
      scope={scope}
      kinds={PATIENT_PERIOD_KINDS}
      exportFile={(p) => exportPatientExcel('new-returning', p)}
      useReport={usePatientNewReturningQuery}
      buildPrint={buildPatientNewReturningPrintSpec}
      errorMessage="Không tải được báo cáo bệnh nhân mới và cũ."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
