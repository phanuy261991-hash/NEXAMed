import { UserCircle } from '@phosphor-icons/react';
import type { RevenueByCashierReport } from '@nexamed/shared';
import { formatVndPlain } from '../../../shared/format/currency';
import { formatDateTimeVn } from '../../../shared/format/time';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { formatCount } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportRevenueExcel, type RevenuePeriodParams } from './revenue.api';
import { useRevenueByCashierQuery } from './revenue.queries';
import { buildRevenueByCashierPrintSpec } from './revenue-print-builders';
import { formatSigned } from './revenue-model';
import { REVENUE_PERIOD_KINDS } from './RevenueByPeriodTab';

/** Chênh lệch kiểm đếm: 0 màu xám, lệch (thiếu hoặc thừa) màu đỏ. */
const discrepancyClass = (value: number | null) => (value === null || value === 0 ? 'text-slate-600' : 'font-semibold text-rose-700');

function kpis(report: RevenueByCashierReport): ReportKpiItem[] {
  const t = report.totals;
  return [
    { label: 'Thực thu', value: formatVndPlain(t.net), tone: 'green', sub: `Thu ${formatVndPlain(t.collected)}, hoàn ${formatVndPlain(t.refunded)}` },
    { label: 'Số ca thu ngân', value: formatCount(t.shiftCount), sub: 'Ca mở trong kỳ' },
    { label: 'Chênh lệch kiểm đếm', value: formatSigned(t.discrepancy), tone: t.discrepancy === 0 ? 'default' : 'rose', sub: 'Kiểm đếm trừ dự kiến, các ca đã chốt' },
    { label: 'Ca lệch', value: formatCount(t.discrepancyShiftCount), tone: t.discrepancyShiftCount > 0 ? 'amber' : 'default', sub: 'Ca đã chốt có chênh lệch' },
  ];
}

function Body({ report }: { report: RevenueByCashierReport }) {
  if (report.cashiers.length === 0 && report.shifts.length === 0) {
    return <EmptyState icon={UserCircle} title="Chưa có thanh toán hay ca thu ngân trong kỳ" description="Không có khoản thu nào và không ca nào mở trong kỳ đã chọn. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const multiBranch = report.branchCount > 1;
  const t = report.totals;
  const capped = report.shiftTotal > report.shifts.length;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu doanh thu theo thu ngân" />
      <ReportCard title="Theo thu ngân" hint="Thu ngân là người ghi nhận khoản thanh toán">
        <ReportGridTable
          ariaLabel="Doanh thu theo thu ngân"
          minWidth={820}
          columns={[
            { header: 'Thu ngân', width: 'minmax(160px, 1.4fr)' },
            { header: 'Số ca', align: 'right', width: '70px' },
            { header: 'Tiền thu', align: 'right', width: '120px' },
            { header: 'Tiền hoàn', align: 'right', width: '110px' },
            { header: 'Thực thu', align: 'right', width: '120px' },
            { header: 'Chênh lệch', align: 'right', width: '110px' },
            { header: 'Ca lệch', align: 'right', width: '80px' },
          ]}
          rows={report.cashiers.map((c) => [
            <span key="n" className="font-semibold text-slate-900">{c.name}</span>,
            formatCount(c.shiftCount),
            formatVndPlain(c.collected),
            <span key="f" className={c.refunded > 0 ? 'text-rose-700' : 'text-slate-600'}>{formatVndPlain(c.refunded)}</span>,
            <span key="a" className="font-semibold text-emerald-700">{formatVndPlain(c.net)}</span>,
            <span key="d" className={discrepancyClass(c.discrepancy)}>{formatSigned(c.discrepancy)}</span>,
            formatCount(c.discrepancyShiftCount),
          ])}
          footer={['Cộng', formatCount(t.shiftCount), formatVndPlain(t.collected), formatVndPlain(t.refunded), formatVndPlain(t.net), formatSigned(t.discrepancy), formatCount(t.discrepancyShiftCount)]}
          emptyText="Không có thanh toán nào trong kỳ đã chọn."
        />
      </ReportCard>
      <ReportCard title="Các ca thu ngân" hint={capped ? `${formatCount(report.shifts.length)} ca mới nhất trong ${formatCount(report.shiftTotal)}` : 'Mới nhất trước'}>
        <ReportGridTable
          ariaLabel="Các ca thu ngân"
          minWidth={multiBranch ? 980 : 860}
          columns={[
            { header: 'Số ca', width: '130px' },
            { header: 'Thu ngân', width: 'minmax(140px, 1.2fr)' },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: 'minmax(110px, 1fr)' }] : []),
            { header: 'Mở lúc', width: '130px' },
            { header: 'Trạng thái', width: '90px' },
            { header: 'Dự kiến', align: 'right' as const, width: '110px' },
            { header: 'Kiểm đếm', align: 'right' as const, width: '110px' },
            { header: 'Chênh lệch', align: 'right' as const, width: '100px' },
          ]}
          rows={report.shifts.map((s) => [
            <span key="no" className="font-semibold text-slate-900">{s.shiftNo}</span>,
            s.cashierName,
            ...(multiBranch ? [s.branchName] : []),
            formatDateTimeVn(s.openedAt),
            <span key="st" className={s.status === 'OPEN' ? 'text-amber-700' : 'text-slate-700'}>{s.status === 'OPEN' ? 'Đang mở' : 'Đã chốt'}</span>,
            s.expectedCash === null ? '—' : formatVndPlain(s.expectedCash),
            s.countedCash === null ? '—' : formatVndPlain(s.countedCash),
            <span key="d" className={discrepancyClass(s.discrepancy)}>{s.discrepancy === null ? '—' : formatSigned(s.discrepancy)}</span>,
          ])}
          maxBodyHeightClass="max-h-[420px]"
          emptyText="Không có ca thu ngân nào mở trong kỳ đã chọn."
        />
      </ReportCard>
    </>
  );
}

/** Tab "Theo thu ngân và chốt ca": thu/hoàn theo người ghi nhận, chênh lệch kiểm đếm và danh sách ca mở trong kỳ. */
export function RevenueByCashierTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<RevenueByCashierReport, RevenuePeriodParams>
      period={period}
      scope={scope}
      kinds={REVENUE_PERIOD_KINDS}
      exportFile={(p) => exportRevenueExcel('by-cashier', p)}
      useReport={useRevenueByCashierQuery}
      buildPrint={buildRevenueByCashierPrintSpec}
      errorMessage="Không tải được báo cáo doanh thu theo thu ngân."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
