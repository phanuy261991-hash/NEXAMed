import { Link } from 'react-router-dom';
import { CheckCircle } from '@phosphor-icons/react';
import type { QualityIncompleteReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import { formatDateTimeVn } from '../../../shared/format/time';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { formatCount } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportQualityExcel, type QualityPeriodParams } from './quality.api';
import { useQualityIncompleteQuery } from './quality.queries';
import { buildQualityIncompletePrintSpec } from './quality-print-builders';
import { UNPAID_REPORT_LINK, encounterStatusLabel, formatDaysOpen } from './quality-model';

function kpis(report: QualityIncompleteReport): ReportKpiItem[] {
  const s = report.summary;
  return [
    { label: 'Lượt khám treo', value: formatCount(s.staleEncounters), tone: s.staleEncounters > 0 ? 'amber' : 'default', sub: 'chờ khám hoặc đang khám từ ngày trước' },
    { label: 'Ca thu ngân chưa đóng', value: formatCount(s.openShifts), tone: s.openShifts > 0 ? 'amber' : 'default', sub: 'mở từ ngày trước' },
    { label: 'Phiếu chưa thu', value: formatCount(s.unpaidInvoices), tone: s.unpaidInvoices > 0 ? 'amber' : 'default', sub: 'của lượt khám từ ngày trước' },
    { label: 'Treo lâu nhất', value: s.oldestEncounterDays === null ? '—' : formatDaysOpen(s.oldestEncounterDays), sub: 'tính đến hôm nay' },
  ];
}

function Body({ report }: { report: QualityIncompleteReport }) {
  const s = report.summary;
  if (s.staleEncounters === 0 && s.openShifts === 0 && s.unpaidInvoices === 0) {
    return <EmptyState icon={CheckCircle} title="Không có gì tồn đọng" description={`Đến hết ngày ${formatDobDisplay(report.asOf)} không còn lượt khám treo, ca thu ngân chưa đóng hay phiếu chưa thu từ các ngày trước.`} />;
  }
  const multiBranch = report.branchCount > 1;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu lượt khám chưa hoàn tất" />
      {s.unpaidInvoices > 0 && (
        <p className="text-sm text-slate-700">
          Phiếu chưa thu xem chi tiết ở{' '}
          <Link to={UNPAID_REPORT_LINK} className="font-semibold text-blue-700 hover:underline">
            báo cáo Doanh thu → Phiếu chưa thu
          </Link>
          .
        </p>
      )}
      <ReportCard title="Lượt khám treo" hint={s.staleEncounters > report.encounters.length ? `Treo lâu nhất trước · ${formatCount(report.encounters.length)} trong ${formatCount(s.staleEncounters)}` : 'Treo lâu nhất trước'}>
        <ReportGridTable
          ariaLabel="Lượt khám treo"
          minWidth={multiBranch ? 980 : 860}
          columns={[
            { header: 'Mã lượt khám', width: '140px' },
            { header: 'Bệnh nhân', width: 'minmax(170px, 1.4fr)' },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 'minmax(100px, 0.8fr)' }] : []),
            { header: 'Bác sĩ', width: 'minmax(110px, 1fr)' },
            { header: 'Tiếp nhận', align: 'right' as const, width: '92px' },
            { header: 'Trạng thái', width: '96px' },
            { header: 'Đã treo', align: 'right' as const, width: '90px' },
          ]}
          rows={report.encounters.map((r) => [
            <span key="c" className="font-semibold text-slate-900">{r.encounterNo}</span>,
            <div key="p" className="min-w-0">
              <div className="truncate font-semibold text-slate-900">{r.patientName}</div>
              <div className="text-[13px] text-slate-600">{r.patientCode}</div>
            </div>,
            ...(multiBranch ? [<span key="b" className="text-slate-700">{r.branchName}</span>] : []),
            <span key="d" className="text-slate-700">{r.doctorName ?? '—'}</span>,
            formatDobDisplay(r.visitDate),
            <span key="s" className="text-slate-800">{encounterStatusLabel(r.status)}</span>,
            <span key="o" className="font-semibold text-amber-700">{formatDaysOpen(r.daysOpen)}</span>,
          ])}
          emptyText="Không có lượt khám nào treo từ các ngày trước."
          maxBodyHeightClass="max-h-[480px]"
        />
      </ReportCard>
      <ReportCard title="Ca thu ngân chưa đóng" hint="Mở từ các ngày trước">
        <ReportGridTable
          ariaLabel="Ca thu ngân chưa đóng"
          minWidth={multiBranch ? 760 : 640}
          columns={[
            { header: 'Mã ca', width: '160px' },
            { header: 'Thu ngân', width: 'minmax(150px, 1.2fr)' },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 'minmax(100px, 0.8fr)' }] : []),
            { header: 'Mở lúc', align: 'right' as const, width: '140px' },
            { header: 'Đã mở', align: 'right' as const, width: '90px' },
          ]}
          rows={report.shifts.map((r) => [
            <span key="c" className="font-semibold text-slate-900">{r.shiftNo}</span>,
            <span key="n" className="text-slate-800">{r.cashierName}</span>,
            ...(multiBranch ? [<span key="b" className="text-slate-700">{r.branchName}</span>] : []),
            <span key="t" className="tabular-nums">{formatDateTimeVn(r.openedAt)}</span>,
            <span key="o" className="font-semibold text-amber-700">{formatDaysOpen(r.daysOpen)}</span>,
          ])}
          emptyText="Không có ca thu ngân nào mở từ các ngày trước."
        />
      </ReportCard>
    </>
  );
}

/** Dòng thay bộ chọn kỳ: báo cáo là ảnh chụp tình trạng đến hôm nay, không theo kỳ. */
function SnapshotNote() {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-slate-800">Thời điểm</span>
      <span className="flex h-9 items-center rounded-md border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700">Tình trạng đến hôm nay</span>
    </div>
  );
}

/** Tab "Lượt khám chưa hoàn tất": lượt chờ khám/đang khám từ các ngày trước, ca thu ngân chưa đóng, số phiếu chưa thu — tình trạng đến hôm nay, không theo kỳ. */
export function QualityIncompleteTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<QualityIncompleteReport, QualityPeriodParams>
      period={period}
      scope={scope}
      periodControl={<SnapshotNote />}
      exportFile={(p) => exportQualityExcel('incomplete', p)}
      useReport={useQualityIncompleteQuery}
      buildPrint={buildQualityIncompletePrintSpec}
      errorMessage="Không tải được báo cáo lượt khám chưa hoàn tất."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
