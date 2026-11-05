import { Stethoscope } from '@phosphor-icons/react';
import type { RevenueByServiceReport } from '@nexamed/shared';
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
import { useRevenueByServiceQuery } from './revenue.queries';
import { buildRevenueByServicePrintSpec } from './revenue-print-builders';
import { REVENUE_GROUP_LABEL } from './revenue-model';
import { REVENUE_PERIOD_KINDS } from './RevenueByPeriodTab';

function kpis(report: RevenueByServiceReport): ReportKpiItem[] {
  return [
    { label: 'Tổng ghi nhận', value: formatVndPlain(report.totalAmount), sub: 'Theo ngày khám, đã trừ chiết khấu' },
    ...report.groups.map((g) => ({ label: REVENUE_GROUP_LABEL[g.group], value: formatVndPlain(g.amount), tone: 'slate' as const, sub: `${formatPercent(g.sharePercent)} · ${formatCount(g.quantity)} lượt dùng` })),
  ];
}

function Body({ report }: { report: RevenueByServiceReport }) {
  if (report.rowTotal === 0) {
    return <EmptyState icon={Stethoscope} title="Chưa có dịch vụ nào được dùng trong kỳ" description="Không có phiếu thu nào có dịch vụ trong kỳ đã chọn. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const max = report.rows[0]?.amount ?? 0;
  const capped = report.rowTotal > report.rows.length;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu doanh thu theo nhóm" />
      <ReportCard title="Theo dịch vụ" hint={capped ? `${formatCount(report.rows.length)} dịch vụ cao nhất trong ${formatCount(report.rowTotal)}` : 'Xếp theo doanh thu ghi nhận'}>
        <ReportGridTable
          ariaLabel="Doanh thu theo dịch vụ"
          minWidth={860}
          columns={[
            { header: 'Nhóm', width: '130px' },
            { header: 'Dịch vụ', width: 'minmax(200px, 2fr)' },
            { header: 'Số lượng', align: 'right', width: '90px' },
            { header: 'Số phiếu', align: 'right', width: '90px' },
            { header: 'Ghi nhận', align: 'right', width: '120px' },
            { header: 'Tỉ trọng', width: 'minmax(150px, 1fr)' },
          ]}
          rows={report.rows.map((r) => [
            <span key="g" className="text-slate-600">{REVENUE_GROUP_LABEL[r.group]}</span>,
            <span key="n" className="font-semibold text-slate-900">{r.name}</span>,
            formatCount(r.quantity),
            formatCount(r.invoiceCount),
            <span key="a" className="font-semibold">{formatVndPlain(r.amount)}</span>,
            <div key="p" className="grid grid-cols-[minmax(0,1fr)_56px] items-center gap-x-2">
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-blue-600" style={{ width: `${barWidthPercent(r.amount, max)}%` }} />
              </div>
              <span className="text-right font-semibold tabular-nums">{formatPercent(r.sharePercent)}</span>
            </div>,
          ])}
          footer={['Cộng', '', formatCount(report.groups.reduce((s, g) => s + g.quantity, 0)), '', formatVndPlain(report.totalAmount), '']}
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
    </>
  );
}

/** Tab "Theo nhóm và dịch vụ": số lượng và doanh thu ghi nhận của từng dịch vụ đã dùng, kèm tổng theo bốn nhóm. */
export function RevenueByServiceTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<RevenueByServiceReport, RevenuePeriodParams>
      period={period}
      scope={scope}
      kinds={REVENUE_PERIOD_KINDS}
      exportFile={(p) => exportRevenueExcel('by-service', p)}
      useReport={useRevenueByServiceQuery}
      buildPrint={buildRevenueByServicePrintSpec}
      errorMessage="Không tải được báo cáo doanh thu theo dịch vụ."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
