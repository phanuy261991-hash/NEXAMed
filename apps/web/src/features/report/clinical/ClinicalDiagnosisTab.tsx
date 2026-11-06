import { Stethoscope } from '@phosphor-icons/react';
import type { ClinicalDiagnosisReport } from '@nexamed/shared';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatCount, formatPercent } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { PeriodKind } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportClinicalExcel, type ClinicalPeriodParams } from './clinical.api';
import { useClinicalDiagnosesQuery } from './clinical.queries';
import { buildClinicalDiagnosisPrintSpec } from './clinical-print-builders';

/** Kỳ của các tab Chuyên môn: 7 ngày, Tháng này, Tháng trước, Quý, Tuỳ chọn (cùng nhóm Bác sĩ và Bệnh nhân). */
export const CLINICAL_PERIOD_KINDS: readonly PeriodKind[] = ['last7', 'thisMonth', 'lastMonth', 'quarter', 'custom'];

function kpis(report: ClinicalDiagnosisReport): ReportKpiItem[] {
  const s = report.summary;
  return [
    { label: 'Lượt khám hoàn tất', value: formatCount(s.completedVisits), sub: 'trong kỳ' },
    { label: 'Có chẩn đoán chính', value: formatCount(s.withDiagnosis), tone: 'blue', sub: formatPercent(s.completedVisits > 0 ? Math.round((s.withDiagnosis / s.completedVisits) * 1000) / 10 : null) + ' số lượt' },
    { label: 'Chưa có chẩn đoán', value: formatCount(s.withoutDiagnosis), tone: s.withoutDiagnosis > 0 ? 'amber' : 'default', sub: 'lượt hoàn tất chưa ghi mã' },
    { label: 'Số mã bệnh', value: formatCount(s.distinctCodes), sub: s.topCode ? `nhiều nhất ${s.topCode}` : 'chưa có' },
  ];
}

function Body({ report }: { report: ClinicalDiagnosisReport }) {
  if (report.summary.completedVisits === 0) {
    return <EmptyState icon={Stethoscope} title="Không có lượt khám hoàn tất nào trong kỳ" description="Chưa có lượt khám nào hoàn tất trong kỳ đã chọn. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const maxRow = Math.max(0, ...report.rows.map((r) => r.visits));
  const maxChapter = Math.max(0, ...report.chapters.map((c) => c.visits));
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu cơ cấu chẩn đoán ICD-10" />
      <ReportCard title="Bệnh hay gặp" hint={report.rows.length < report.summary.distinctCodes ? `${formatCount(report.rows.length)} mã đầu trong ${formatCount(report.summary.distinctCodes)}` : 'Theo mã chẩn đoán chính'}>
        <ReportGridTable
          ariaLabel="Bệnh hay gặp"
          minWidth={760}
          columns={[
            { header: '#', width: '40px' },
            { header: 'Mã', width: '84px' },
            { header: 'Tên bệnh', width: 'minmax(220px, 2fr)' },
            { header: 'Lượt khám', align: 'right', width: '84px' },
            { header: 'Bệnh nhân', align: 'right', width: '84px' },
            { header: 'Tỉ lệ', align: 'right', width: '64px' },
            { header: '', width: 'minmax(80px, 0.8fr)' },
          ]}
          rows={report.rows.map((r, i) => [
            <span key="i" className="font-semibold text-slate-700">{i + 1}</span>,
            <span key="c" className="font-semibold text-slate-900">{r.code}</span>,
            <span key="n" className="text-slate-800">{r.name || '—'}</span>,
            <span key="v" className="font-semibold">{formatCount(r.visits)}</span>,
            formatCount(r.patients),
            formatPercent(r.percent),
            <div key="b" className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-blue-600" style={{ width: `${barWidthPercent(r.visits, maxRow)}%` }} />
            </div>,
          ])}
          emptyText="Chưa có lượt khám nào có chẩn đoán trong kỳ đã chọn."
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
      <ReportCard title="Theo chương ICD-10" hint="Nhóm bệnh theo chương của Bộ Y tế">
        <ReportGridTable
          ariaLabel="Chẩn đoán theo chương ICD-10"
          minWidth={620}
          columns={[
            { header: 'Chương', width: '80px' },
            { header: 'Tên chương', width: 'minmax(220px, 2fr)' },
            { header: 'Lượt khám', align: 'right', width: '84px' },
            { header: 'Tỉ lệ', align: 'right', width: '64px' },
            { header: '', width: 'minmax(80px, 0.8fr)' },
          ]}
          rows={report.chapters.map((c) => [
            <span key="c" className="font-semibold text-slate-900">{c.chapterCode}</span>,
            <span key="n" className="text-slate-800">{c.chapterName}</span>,
            <span key="v" className="font-semibold">{formatCount(c.visits)}</span>,
            formatPercent(c.percent),
            <div key="b" className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-teal-600" style={{ width: `${barWidthPercent(c.visits, maxChapter)}%` }} />
            </div>,
          ])}
          emptyText="Chưa có dữ liệu."
        />
      </ReportCard>
    </>
  );
}

/** Tab "Cơ cấu chẩn đoán ICD-10": bệnh hay gặp trong kỳ theo mã chẩn đoán chính của lượt khám hoàn tất, và theo chương ICD-10. */
export function ClinicalDiagnosisTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<ClinicalDiagnosisReport, ClinicalPeriodParams>
      period={period}
      scope={scope}
      kinds={CLINICAL_PERIOD_KINDS}
      exportFile={(p) => exportClinicalExcel('diagnoses', p)}
      useReport={useClinicalDiagnosesQuery}
      buildPrint={buildClinicalDiagnosisPrintSpec}
      errorMessage="Không tải được báo cáo cơ cấu chẩn đoán ICD-10."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
