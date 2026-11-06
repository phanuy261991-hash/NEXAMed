import { Link } from 'react-router-dom';
import { UserMinus } from '@phosphor-icons/react';
import type { PatientNotReturningReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { formatCount } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportPatientExcel, type PatientPeriodParams } from './patients.api';
import { PATIENT_PERIOD_KINDS } from './PatientNewReturningTab';
import { usePatientNotReturningQuery } from './patients.queries';
import { buildPatientNotReturningPrintSpec } from './patients-print-builders';
import { patientProfileLink, reminderLabel, reminderToneClass } from './patients-model';

function kpis(report: PatientNotReturningReport): ReportKpiItem[] {
  const s = report.summary;
  return [
    { label: 'Quá hạn chưa quay lại', value: formatCount(s.patients), tone: s.patients > 0 ? 'amber' : 'default', sub: 'bệnh nhân' },
    { label: 'Đã được nhắc', value: formatCount(s.reminded), tone: 'blue', sub: `${formatCount(s.patients - s.reminded)} chưa nhắc lần nào` },
    { label: 'Đã ghi không tái khám', value: formatCount(s.markedNotReturning), sub: 'bệnh nhân báo không quay lại' },
    { label: 'Quá hạn trung bình', value: s.avgOverdueDays === null ? '—' : `${s.avgOverdueDays} ngày`, sub: 'tính đến hôm nay' },
  ];
}

function Body({ report }: { report: PatientNotReturningReport }) {
  if (report.totalCount === 0) {
    return <EmptyState icon={UserMinus} title="Không có bệnh nhân nào quá hẹn" description="Mọi bệnh nhân có ngày hẹn tái khám trong kỳ đã quay lại, hoặc chưa đến ngày hẹn. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const multiBranch = report.branchCount > 1;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu bệnh nhân không quay lại" />
      <ReportCard title="Danh sách bệnh nhân" hint={report.totalCount > report.items.length ? `Quá hạn lâu nhất trước · ${formatCount(report.items.length)} trong ${formatCount(report.totalCount)}` : 'Quá hạn lâu nhất trước'}>
        <ReportGridTable
          ariaLabel="Bệnh nhân không quay lại"
          minWidth={multiBranch ? 1100 : 960}
          columns={[
            { header: 'Bệnh nhân', width: 'minmax(170px, 1.4fr)' },
            { header: 'Điện thoại', width: '112px' },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 'minmax(100px, 0.9fr)' }] : []),
            { header: 'Bác sĩ', width: 'minmax(110px, 1fr)' },
            { header: 'Ngày khám', align: 'right' as const, width: '92px' },
            { header: 'Ngày hẹn', align: 'right' as const, width: '92px' },
            { header: 'Quá hạn', align: 'right' as const, width: '84px' },
            { header: 'Lần nhắc gần nhất', width: 'minmax(150px, 1.1fr)' },
            { header: '', width: '44px' },
          ]}
          rows={report.items.map((r) => [
            <div key="n" className="min-w-0">
              <div className="truncate font-semibold text-slate-900">{r.patientName}</div>
              <div className="text-[13px] text-slate-600">{r.patientCode}</div>
            </div>,
            <span key="ph" className="tabular-nums text-slate-800">{r.phone}</span>,
            ...(multiBranch ? [<span key="br" className="text-slate-700">{r.branchName}</span>] : []),
            <span key="d" className="text-slate-700">{r.doctorName ?? '—'}</span>,
            formatDobDisplay(r.visitDate),
            formatDobDisplay(r.dueDate),
            <span key="o" className="font-semibold text-amber-700">{formatCount(r.overdueDays)} ngày</span>,
            <span key="m" className={reminderToneClass(r.lastReminderResult)}>
              {r.reminderCount > 0 ? `${r.reminderCount} lần · ${reminderLabel(r.lastReminderResult)}` : reminderLabel(null)}
            </span>,
            <Link key="x" to={patientProfileLink(r.patientId)} className="text-sm font-semibold text-blue-700 hover:underline">
              Xem
            </Link>,
          ])}
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
    </>
  );
}

/** Tab "Bệnh nhân không quay lại": bệnh nhân đã hẹn tái khám, quá hạn mà chưa có lượt khám nào sau đó, kèm số lần nhắc. */
export function PatientNotReturningTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<PatientNotReturningReport, PatientPeriodParams>
      period={period}
      scope={scope}
      kinds={PATIENT_PERIOD_KINDS}
      exportFile={(p) => exportPatientExcel('not-returning', p)}
      useReport={usePatientNotReturningQuery}
      buildPrint={buildPatientNotReturningPrintSpec}
      errorMessage="Không tải được báo cáo bệnh nhân không quay lại."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
