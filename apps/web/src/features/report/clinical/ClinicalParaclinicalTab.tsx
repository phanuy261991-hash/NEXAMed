import { Flask } from '@phosphor-icons/react';
import type { ClinicalParaclinicalReport } from '@nexamed/shared';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { formatCount } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportClinicalExcel, type ClinicalPeriodParams } from './clinical.api';
import { CLINICAL_PERIOD_KINDS } from './ClinicalDiagnosisTab';
import { useClinicalParaclinicalQuery } from './clinical.queries';
import { buildClinicalParaclinicalPrintSpec } from './clinical-print-builders';
import { formatDuration, formatWait, kindLabel } from './clinical-model';

function kpis(report: ClinicalParaclinicalReport): ReportKpiItem[] {
  const s = report.summary;
  return [
    { label: 'Chỉ định', value: formatCount(s.ordered), sub: `${formatCount(s.inHouse)} tại phòng khám · ${formatCount(s.external)} ra ngoài` },
    { label: 'Đã trả kết quả', value: formatCount(s.completed), tone: 'green', sub: `${formatCount(s.pending)} chưa trả` },
    { label: 'Trả kết quả trung bình', value: formatDuration(s.avgMinutes), tone: 'blue', sub: 'từ lúc chỉ định đến lần duyệt đầu' },
    { label: 'Quá hạn', value: formatCount(s.overdue), tone: s.overdue > 0 ? 'rose' : 'default', sub: `${formatCount(s.lateCompleted)} trả muộn · ${formatCount(s.overdueOpen)} đang chờ` },
  ];
}

function Body({ report }: { report: ClinicalParaclinicalReport }) {
  const s = report.summary;
  if (s.ordered === 0) {
    return <EmptyState icon={Flask} title="Không có chỉ định cận lâm sàng nào trong kỳ" description="Chưa có chỉ định nào của lượt khám trong kỳ đã chọn. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const multiBranch = report.branchCount > 1;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu cận lâm sàng" />
      <ReportCard title="Theo nhóm dịch vụ" hint="Không tính chỉ định đã huỷ">
        <ReportGridTable
          ariaLabel="Cận lâm sàng theo nhóm dịch vụ"
          minWidth={720}
          columns={[
            { header: 'Nhóm', width: 'minmax(170px, 1.6fr)' },
            { header: 'Chỉ định', align: 'right', width: '80px' },
            { header: 'Tại phòng khám', align: 'right', width: '120px' },
            { header: 'Ra ngoài', align: 'right', width: '80px' },
            { header: 'Đã trả', align: 'right', width: '72px' },
            { header: 'Trả TB', align: 'right', width: '100px' },
            { header: 'Quá hạn', align: 'right', width: '76px' },
          ]}
          rows={report.byKind.map((k) => [
            <span key="n" className="font-semibold text-slate-900">{kindLabel(k.kind)}</span>,
            <span key="o" className="font-semibold">{formatCount(k.ordered)}</span>,
            formatCount(k.inHouse),
            formatCount(k.external),
            formatCount(k.completed),
            formatDuration(k.avgMinutes),
            <span key="d" className={k.overdue > 0 ? 'font-semibold text-rose-700' : ''}>{formatCount(k.overdue)}</span>,
          ])}
          footer={['Cộng', formatCount(s.ordered), formatCount(s.inHouse), formatCount(s.external), formatCount(s.completed), formatDuration(s.avgMinutes), formatCount(s.overdue)]}
        />
      </ReportCard>
      <ReportCard title="Dịch vụ được chỉ định nhiều nhất" hint={`${formatCount(report.topServices.length)} dịch vụ đầu`}>
        <ReportGridTable
          ariaLabel="Dịch vụ được chỉ định nhiều nhất"
          minWidth={760}
          columns={[
            { header: '#', width: '40px' },
            { header: 'Dịch vụ', width: 'minmax(200px, 2fr)' },
            { header: 'Nhóm', width: 'minmax(130px, 1fr)' },
            { header: 'Chỉ định', align: 'right', width: '80px' },
            { header: 'Đã trả', align: 'right', width: '72px' },
            { header: 'Trả TB', align: 'right', width: '100px' },
            { header: 'Quá hạn', align: 'right', width: '76px' },
          ]}
          rows={report.topServices.map((t, i) => [
            <span key="i" className="font-semibold text-slate-700">{i + 1}</span>,
            <span key="n" className="font-semibold text-slate-900">{t.name}</span>,
            <span key="k" className="text-slate-700">{kindLabel(t.kind)}</span>,
            <span key="o" className="font-semibold">{formatCount(t.ordered)}</span>,
            formatCount(t.completed),
            formatDuration(t.avgMinutes),
            <span key="d" className={t.overdue > 0 ? 'font-semibold text-rose-700' : ''}>{formatCount(t.overdue)}</span>,
          ])}
          emptyText="Chưa có chỉ định nào trong kỳ."
          maxBodyHeightClass="max-h-[420px]"
        />
      </ReportCard>
      <ReportCard title="Đang chờ và đã quá hạn" hint={s.overdueOpen > report.overdueItems.length ? `Chờ lâu nhất trước · ${formatCount(report.overdueItems.length)} trong ${formatCount(s.overdueOpen)}` : 'Chờ lâu nhất trước'}>
        <ReportGridTable
          ariaLabel="Chỉ định đang chờ đã quá hạn"
          minWidth={multiBranch ? 900 : 780}
          columns={[
            { header: 'Bệnh nhân', width: 'minmax(170px, 1.4fr)' },
            { header: 'Dịch vụ', width: 'minmax(170px, 1.4fr)' },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 'minmax(100px, 0.8fr)' }] : []),
            { header: 'Hạn trả', align: 'right' as const, width: '90px' },
            { header: 'Đã chờ', align: 'right' as const, width: '110px' },
          ]}
          rows={report.overdueItems.map((o) => [
            <div key="p" className="min-w-0">
              <div className="truncate font-semibold text-slate-900">{o.patientName}</div>
              <div className="text-[13px] text-slate-600">{o.patientCode}</div>
            </div>,
            <span key="s" className="text-slate-800">{o.serviceName}</span>,
            ...(multiBranch ? [<span key="b" className="text-slate-700">{o.branchName}</span>] : []),
            formatDuration(o.turnaroundMinutes),
            <span key="w" className="font-semibold text-rose-700">{formatWait(o.waitedMinutes)}</span>,
          ])}
          emptyText="Không có chỉ định nào đang chờ quá hạn."
          maxBodyHeightClass="max-h-[420px]"
        />
      </ReportCard>
    </>
  );
}

/** Tab "Cận lâm sàng": số chỉ định, thời gian trả kết quả, số quá hạn theo nhóm dịch vụ, dịch vụ nhiều nhất và chỉ định đang chờ đã quá hạn. */
export function ClinicalParaclinicalTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<ClinicalParaclinicalReport, ClinicalPeriodParams>
      period={period}
      scope={scope}
      kinds={CLINICAL_PERIOD_KINDS}
      exportFile={(p) => exportClinicalExcel('paraclinical', p)}
      useReport={useClinicalParaclinicalQuery}
      buildPrint={buildClinicalParaclinicalPrintSpec}
      errorMessage="Không tải được báo cáo cận lâm sàng."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
