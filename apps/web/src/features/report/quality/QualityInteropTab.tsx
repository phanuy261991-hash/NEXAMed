import { PaperPlaneTilt } from '@phosphor-icons/react';
import type { QualityInteropReport } from '@nexamed/shared';
import { formatDateTimeVn } from '../../../shared/format/time';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { formatCount, formatPercent } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { PeriodKind } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportQualityExcel, type QualityPeriodParams } from './quality.api';
import { useQualityInteropQuery } from './quality.queries';
import { buildQualityInteropPrintSpec } from './quality-print-builders';
import { formatAttempts, interopStatusLabel, interopStatusToneClass, joinErrors } from './quality-model';

/** Kỳ của tab Liên thông: 7 ngày, Tháng này, Tháng trước, Quý, Tuỳ chọn (cùng các nhóm báo cáo khác). */
export const QUALITY_PERIOD_KINDS: readonly PeriodKind[] = ['last7', 'thisMonth', 'lastMonth', 'quarter', 'custom'];

function kpis(report: QualityInteropReport): ReportKpiItem[] {
  const s = report.summary;
  return [
    { label: 'Đơn thuốc đã ký', value: formatCount(s.total), sub: 'trong kỳ' },
    { label: 'Đã gửi', value: formatCount(s.sent), tone: 'green', sub: `${formatPercent(s.sentPercent)} số đơn` },
    { label: 'Chờ gửi', value: formatCount(s.pending), tone: s.pending > 0 ? 'amber' : 'default', sub: s.oldestUnsentDays === null ? 'không có đơn tồn' : `tồn cũ nhất ${s.oldestUnsentDays} ngày` },
    { label: 'Cổng từ chối', value: formatCount(s.failed), tone: s.failed > 0 ? 'rose' : 'default', sub: 'cần sửa dữ liệu rồi gửi lại' },
  ];
}

function Body({ report }: { report: QualityInteropReport }) {
  const s = report.summary;
  if (s.total === 0) {
    return <EmptyState icon={PaperPlaneTilt} title="Không có đơn thuốc nào ký trong kỳ" description="Chưa có đơn thuốc nào được ký trong kỳ đã chọn. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const multiBranch = report.branchCount > 1;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu liên thông đơn thuốc" />
      <ReportCard title="Theo bác sĩ" hint="Đơn tồn nhiều nhất trước">
        <ReportGridTable
          ariaLabel="Liên thông đơn thuốc theo bác sĩ"
          minWidth={560}
          columns={[
            { header: 'Bác sĩ', width: 'minmax(170px, 1.6fr)' },
            { header: 'Đơn', align: 'right', width: '80px' },
            { header: 'Đã gửi', align: 'right', width: '84px' },
            { header: 'Chờ gửi', align: 'right', width: '84px' },
            { header: 'Cổng từ chối', align: 'right', width: '110px' },
          ]}
          rows={report.byDoctor.map((d) => [
            <span key="n" className="font-semibold text-slate-900">{d.doctorName}</span>,
            <span key="t" className="font-semibold">{formatCount(d.total)}</span>,
            formatCount(d.sent),
            <span key="p" className={d.pending > 0 ? 'font-semibold text-amber-700' : ''}>{formatCount(d.pending)}</span>,
            <span key="f" className={d.failed > 0 ? 'font-semibold text-rose-700' : ''}>{formatCount(d.failed)}</span>,
          ])}
          footer={['Cộng', formatCount(s.total), formatCount(s.sent), formatCount(s.pending), formatCount(s.failed)]}
          emptyText="Không có đơn thuốc nào ký trong kỳ đã chọn."
        />
      </ReportCard>
      <ReportCard title="Đơn chờ gửi hoặc bị cổng từ chối" hint={report.problemTotal > report.problems.length ? `Cũ nhất trước · ${formatCount(report.problems.length)} trong ${formatCount(report.problemTotal)}` : 'Cũ nhất trước'}>
        <ReportGridTable
          ariaLabel="Đơn thuốc chờ gửi hoặc bị cổng từ chối"
          minWidth={multiBranch ? 1100 : 980}
          columns={[
            { header: 'Mã lượt khám', width: '140px' },
            { header: 'Bệnh nhân', width: 'minmax(160px, 1.2fr)' },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 'minmax(100px, 0.7fr)' }] : []),
            { header: 'Bác sĩ', width: 'minmax(110px, 0.9fr)' },
            { header: 'Ký lúc', align: 'right' as const, width: '130px' },
            { header: 'Trạng thái', width: '104px' },
            { header: 'Thử', align: 'right' as const, width: '56px' },
            { header: 'Lỗi', width: 'minmax(200px, 1.6fr)' },
          ]}
          rows={report.problems.map((r) => [
            <span key="c" className="font-semibold text-slate-900">{r.encounterNo}</span>,
            <div key="p" className="min-w-0">
              <div className="truncate font-semibold text-slate-900">{r.patientName}</div>
              <div className="text-[13px] text-slate-600">{r.patientCode}</div>
            </div>,
            ...(multiBranch ? [<span key="b" className="text-slate-700">{r.branchName}</span>] : []),
            <span key="d" className="text-slate-700">{r.doctorName ?? '—'}</span>,
            <span key="t" className="tabular-nums">{formatDateTimeVn(r.signedAt)}</span>,
            <span key="s" className={interopStatusToneClass(r.status)}>{interopStatusLabel(r.status)}</span>,
            formatAttempts(r.attempts),
            <span key="e" className="break-words text-slate-800">{joinErrors(r.errors)}</span>,
          ])}
          emptyText="Không có đơn nào chờ gửi hoặc bị cổng từ chối."
          maxBodyHeightClass="max-h-[520px]"
        />
      </ReportCard>
    </>
  );
}

/** Tab "Liên thông đơn thuốc": đơn đã ký trong kỳ gửi lên cổng đơn thuốc quốc gia — đã gửi, chờ gửi, cổng từ chối, theo bác sĩ và danh sách đơn tồn kèm lỗi. */
export function QualityInteropTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<QualityInteropReport, QualityPeriodParams>
      period={period}
      scope={scope}
      kinds={QUALITY_PERIOD_KINDS}
      exportFile={(p) => exportQualityExcel('interop', p)}
      useReport={useQualityInteropQuery}
      buildPrint={buildQualityInteropPrintSpec}
      errorMessage="Không tải được báo cáo liên thông đơn thuốc."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
