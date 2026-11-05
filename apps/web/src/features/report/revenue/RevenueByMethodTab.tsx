import { CreditCard } from '@phosphor-icons/react';
import type { RevenueByMethodReport } from '@nexamed/shared';
import { formatVndPlain } from '../../../shared/format/currency';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatCount, formatPercent } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportRevenueExcel, type RevenuePeriodParams } from './revenue.api';
import { useRevenueByMethodQuery } from './revenue.queries';
import { buildRevenueByMethodPrintSpec } from './revenue-print-builders';
import { REVENUE_PERIOD_KINDS } from './RevenueByPeriodTab';

function kpis(report: RevenueByMethodReport): ReportKpiItem[] {
  const t = report.totals;
  const top = report.rows[0];
  return [
    { label: 'Thực thu', value: formatVndPlain(t.net), tone: 'green', sub: 'Thu trừ hoàn tiền, theo ngày thu' },
    { label: 'Tiền thu', value: formatVndPlain(t.collected), sub: `${formatCount(t.paymentCount)} lượt thanh toán` },
    { label: 'Hoàn tiền', value: formatVndPlain(t.refunded), tone: 'rose', sub: `${formatCount(t.refundCount)} lượt hoàn` },
    { label: 'Phương thức nhiều nhất', value: top ? top.methodName : '—', sub: top ? `${formatPercent(top.sharePercent)} thực thu` : 'chưa có khoản thu' },
  ];
}

function Body({ report }: { report: RevenueByMethodReport }) {
  if (report.rows.length === 0) {
    return <EmptyState icon={CreditCard} title="Chưa có khoản thu nào trong kỳ" description="Không có thanh toán nào được ghi nhận trong kỳ đã chọn. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const max = Math.max(0, ...report.rows.map((r) => r.net));
  const t = report.totals;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu doanh thu theo phương thức" />
      <ReportCard title="Theo phương thức thanh toán" hint="Xếp theo thực thu">
        <ReportGridTable
          ariaLabel="Doanh thu theo phương thức thanh toán"
          minWidth={900}
          columns={[
            { header: 'Phương thức', width: 'minmax(150px, 1.4fr)' },
            { header: 'Lượt thu', align: 'right', width: '80px' },
            { header: 'Tiền thu', align: 'right', width: '120px' },
            { header: 'Lượt hoàn', align: 'right', width: '90px' },
            { header: 'Tiền hoàn', align: 'right', width: '110px' },
            { header: 'Thực thu', align: 'right', width: '120px' },
            { header: 'Tỉ trọng', width: 'minmax(150px, 1fr)' },
          ]}
          rows={report.rows.map((r) => [
            <span key="n" className="font-semibold text-slate-900">{r.methodName}</span>,
            formatCount(r.paymentCount),
            formatVndPlain(r.collected),
            formatCount(r.refundCount),
            <span key="f" className={r.refunded > 0 ? 'text-rose-700' : 'text-slate-600'}>{formatVndPlain(r.refunded)}</span>,
            <span key="a" className="font-semibold text-emerald-700">{formatVndPlain(r.net)}</span>,
            <div key="p" className="grid grid-cols-[minmax(0,1fr)_56px] items-center gap-x-2">
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-emerald-700" style={{ width: `${barWidthPercent(r.net, max)}%` }} />
              </div>
              <span className="text-right font-semibold tabular-nums">{formatPercent(r.sharePercent)}</span>
            </div>,
          ])}
          footer={['Cộng', formatCount(t.paymentCount), formatVndPlain(t.collected), formatCount(t.refundCount), formatVndPlain(t.refunded), formatVndPlain(t.net), '']}
        />
      </ReportCard>
    </>
  );
}

/** Tab "Theo phương thức": tiền thu, hoàn và thực thu theo hình thức thanh toán (tiền mặt, chuyển khoản, thẻ, ví...). */
export function RevenueByMethodTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<RevenueByMethodReport, RevenuePeriodParams>
      period={period}
      scope={scope}
      kinds={REVENUE_PERIOD_KINDS}
      exportFile={(p) => exportRevenueExcel('by-method', p)}
      useReport={useRevenueByMethodQuery}
      buildPrint={buildRevenueByMethodPrintSpec}
      errorMessage="Không tải được báo cáo doanh thu theo phương thức."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
