import { UsersThree } from '@phosphor-icons/react';
import type { SystemCrossReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { formatCount, formatPercent } from '../operations/operations-model';
import type { OperationsPeriodParams } from '../operations/operations.api';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import { periodCaption } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportSystemExcel } from './system.api';
import { useSystemCrossQuery } from './system.queries';
import { SYSTEM_PERIOD_KINDS } from './system-model';
import { buildSystemCrossPrintSpec } from './system-print-builders';

function kpis(report: SystemCrossReport): ReportKpiItem[] {
  const t = report.totals;
  return [
    { label: 'Bệnh nhân có lượt khám', value: formatCount(t.patientCount), sub: 'trong phạm vi và kỳ đang xem' },
    { label: 'Khám ở từ hai chi nhánh', value: formatCount(t.crossPatientCount), tone: 'blue', sub: 'bệnh nhân' },
    { label: 'Tỉ lệ khám chéo', value: formatPercent(t.crossPercent), tone: 'teal', sub: 'trên số bệnh nhân có lượt khám' },
    { label: 'Lượt khám của nhóm này', value: formatCount(t.crossVisits), sub: 'tổng các chi nhánh' },
  ];
}

function Body({ report, from, to }: { report: SystemCrossReport; from: string; to: string }) {
  if (report.branchCount < 2) {
    return <EmptyState icon={UsersThree} title="Cần xem từ hai chi nhánh" description="Khám chéo chi nhánh chỉ có khi phạm vi gồm từ hai chi nhánh. Chọn Tất cả chi nhánh hoặc chọn ít nhất hai chi nhánh." />;
  }
  const caption = periodCaption({ from, to });
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu khám chéo chi nhánh" />
      {report.rowTotal === 0 ? (
        <EmptyState icon={UsersThree} title="Không có bệnh nhân khám chéo trong kỳ" description="Chưa có bệnh nhân nào khám ở từ hai chi nhánh trong kỳ đã chọn. Đổi kỳ hoặc phạm vi chi nhánh." />
      ) : (
        <>
          <ReportCard title={`Theo cặp chi nhánh, ${caption}`} hint="Bệnh nhân khám ở cả hai">
            <ReportGridTable
              ariaLabel="Khám chéo theo cặp chi nhánh"
              minWidth={520}
              columns={[
                { header: 'Chi nhánh A', width: 'minmax(160px, 1fr)' },
                { header: 'Chi nhánh B', width: 'minmax(160px, 1fr)' },
                { header: 'Số bệnh nhân', align: 'right', width: '120px' },
              ]}
              rows={report.pairs.map((p) => [<span key="a" className="font-semibold text-slate-900">{p.branchAName}</span>, <span key="b" className="font-semibold text-slate-900">{p.branchBName}</span>, formatCount(p.patientCount)])}
            />
          </ReportCard>
          <ReportCard title={`Bệnh nhân khám chéo, ${caption}`} hint={report.rowTotal > report.rows.length ? `${formatCount(report.rows.length)} bệnh nhân khám nhiều lượt nhất · còn ${formatCount(report.rowTotal - report.rows.length)} bệnh nhân khác` : `${formatCount(report.rowTotal)} bệnh nhân`}>
            <ReportGridTable
              ariaLabel="Danh sách bệnh nhân khám chéo chi nhánh"
              minWidth={900}
              columns={[
                { header: 'Mã bệnh nhân', width: '130px' },
                { header: 'Họ tên', width: 'minmax(160px, 1.2fr)' },
                { header: 'Số chi nhánh', align: 'right', width: '100px' },
                { header: 'Số lượt', align: 'right', width: '76px' },
                { header: 'Chi nhánh (số lượt)', width: 'minmax(220px, 1.6fr)' },
                { header: 'Khám gần nhất', width: '120px' },
              ]}
              rows={report.rows.map((r) => [
                <span key="c" className="tabular-nums">{r.patientCode}</span>,
                <span key="n" className="font-semibold text-slate-900">{r.patientName}</span>,
                formatCount(r.branchCount),
                formatCount(r.visitCount),
                <span key="b" className="text-slate-700">{r.branches.map((b) => `${b.branchName} (${b.visits})`).join(', ')}</span>,
                formatDobDisplay(r.lastVisitDate),
              ])}
              maxBodyHeightClass="max-h-[480px]"
            />
          </ReportCard>
        </>
      )}
    </>
  );
}

/** Tab "Khám chéo chi nhánh": bệnh nhân dùng chung cả công ty đã khám ở từ hai chi nhánh trong kỳ. Không hiện tiền theo bệnh nhân (hướng chi nhánh #231). */
export function SystemCrossTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<SystemCrossReport, OperationsPeriodParams>
      period={period}
      scope={scope}
      kinds={SYSTEM_PERIOD_KINDS}
      exportFile={(p) => exportSystemExcel('cross', p)}
      useReport={useSystemCrossQuery}
      buildPrint={buildSystemCrossPrintSpec}
      errorMessage="Không tải được báo cáo khám chéo chi nhánh."
    >
      {(report) => <Body report={report} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}
