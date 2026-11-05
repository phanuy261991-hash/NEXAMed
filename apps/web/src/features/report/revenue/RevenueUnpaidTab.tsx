import { Receipt } from '@phosphor-icons/react';
import type { RevenueUnpaidReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import { formatVndPlain } from '../../../shared/format/currency';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { formatCount } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportRevenueExcel, type RevenuePeriodParams } from './revenue.api';
import { useRevenueUnpaidQuery } from './revenue.queries';
import { buildRevenueUnpaidPrintSpec } from './revenue-print-builders';
import { ageToneClass, formatAgeDays, INVOICE_TYPE_LABEL } from './revenue-model';
import { REVENUE_PERIOD_KINDS } from './RevenueByPeriodTab';

function kpis(report: RevenueUnpaidReport): ReportKpiItem[] {
  return [
    { label: 'Phiếu chưa thu', value: formatCount(report.totalCount), tone: 'amber', sub: 'Của các lượt khám trong kỳ' },
    { label: 'Tổng phải thu', value: formatVndPlain(report.totalAmount), sub: 'Đã trừ chiết khấu' },
    { label: 'Phiếu cũ nhất', value: report.oldestAgeDays === null ? '—' : formatAgeDays(report.oldestAgeDays), tone: report.oldestAgeDays !== null && report.oldestAgeDays > 30 ? 'rose' : 'default', sub: 'Tính từ ngày khám' },
  ];
}

function Body({ report }: { report: RevenueUnpaidReport }) {
  if (report.totalCount === 0) {
    return <EmptyState icon={Receipt} title="Không có phiếu chưa thu" description="Mọi phiếu của các lượt khám trong kỳ đã được thu hoặc huỷ. Đổi kỳ hoặc phạm vi chi nhánh để xem thêm." />;
  }
  const multiBranch = report.branchCount > 1;
  const capped = report.totalCount > report.rows.length;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu phiếu chưa thu" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <ReportCard title="Theo tuổi phiếu" hint="Từ ngày khám đến hôm nay">
          <ReportGridTable
            ariaLabel="Phiếu chưa thu theo tuổi phiếu"
            columns={[{ header: 'Tuổi phiếu', width: 'minmax(110px, 1fr)' }, { header: 'Số phiếu', align: 'right', width: '80px' }, { header: 'Số tiền', align: 'right', width: '120px' }]}
            rows={report.aging.map((a) => [a.label, formatCount(a.invoiceCount), formatVndPlain(a.amount)])}
            footer={['Cộng', formatCount(report.totalCount), formatVndPlain(report.totalAmount)]}
          />
        </ReportCard>
        <ReportCard title="Danh sách phiếu" hint={capped ? `${formatCount(report.rows.length)} phiếu cũ nhất trong ${formatCount(report.totalCount)}` : 'Cũ nhất trước'}>
          <ReportGridTable
            ariaLabel="Danh sách phiếu chưa thu"
            minWidth={multiBranch ? 900 : 760}
            columns={[
              { header: 'Số phiếu', width: '130px' },
              { header: 'Loại', width: '110px' },
              { header: 'Ngày khám', width: '100px' },
              { header: 'Tuổi', align: 'right', width: '80px' },
              { header: 'Bệnh nhân', width: 'minmax(160px, 1.4fr)' },
              ...(multiBranch ? [{ header: 'Chi nhánh', width: 'minmax(110px, 1fr)' }] : []),
              { header: 'Phải thu', align: 'right' as const, width: '110px' },
            ]}
            rows={report.rows.map((r) => [
              <span key="no" className="font-semibold text-slate-900">{r.invoiceNo}</span>,
              INVOICE_TYPE_LABEL[r.invoiceType] ?? r.invoiceType,
              formatDobDisplay(r.date),
              <span key="a" className={ageToneClass(r.ageDays)}>{formatAgeDays(r.ageDays)}</span>,
              <span key="p">{r.patientName} <span className="text-slate-500">({r.patientCode})</span></span>,
              ...(multiBranch ? [r.branchName] : []),
              <span key="m" className="font-semibold">{formatVndPlain(r.amount)}</span>,
            ])}
            maxBodyHeightClass="max-h-[520px]"
          />
        </ReportCard>
      </div>
    </>
  );
}

/** Tab "Phiếu chưa thu": phiếu của các lượt khám trong kỳ mà khách chưa thanh toán, cũ nhất trước, phân nhóm theo tuổi phiếu. */
export function RevenueUnpaidTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<RevenueUnpaidReport, RevenuePeriodParams>
      period={period}
      scope={scope}
      kinds={REVENUE_PERIOD_KINDS}
      exportFile={(p) => exportRevenueExcel('unpaid', p)}
      useReport={useRevenueUnpaidQuery}
      buildPrint={buildRevenueUnpaidPrintSpec}
      errorMessage="Không tải được báo cáo phiếu chưa thu."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
