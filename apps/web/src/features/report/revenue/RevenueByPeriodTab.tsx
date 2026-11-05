import { useMemo, useState } from 'react';
import { ChartBar } from '@phosphor-icons/react';
import type { RevenueByPeriodReport, RevenueGroupByCode } from '@nexamed/shared';
import { formatVndPlain } from '../../../shared/format/currency';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import { SegmentedToggle } from '../../../shared/ui/SegmentedToggle';
import type { ReportScopeState } from '../../branch/useReportScope';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import { periodCaption, type PeriodKind } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportRevenueExcel, type RevenueByPeriodParams } from './revenue.api';
import { useRevenueByPeriodQuery } from './revenue.queries';
import { buildRevenueByPeriodPrintSpec } from './revenue-print-builders';
import { deltaToneClass, formatDeltaPercent, recognizedMinusNet, REVENUE_GROUP_BY_ITEMS, REVENUE_GROUP_BY_LABEL, REVENUE_GROUP_LABEL, REVENUE_GROUP_ORDER } from './revenue-model';
import { RevenueBarChart } from './RevenueBarChart';

/** Kỳ của các tab Doanh thu (đúng mockup): Tháng này, Quý, Năm, Tuỳ chọn; "Tháng trước" thêm vào vì chủ phòng khám thường chốt sổ tháng vừa qua. */
export const REVENUE_PERIOD_KINDS: readonly PeriodKind[] = ['thisMonth', 'lastMonth', 'quarter', 'year', 'custom'];

function kpis(report: RevenueByPeriodReport): ReportKpiItem[] {
  const t = report.totals;
  return [
    { label: 'Tổng ghi nhận', value: formatVndPlain(t.recognized), sub: 'Đã trừ chiết khấu' },
    { label: 'Thực thu', value: formatVndPlain(t.net), tone: 'green', sub: 'Thu trừ hoàn tiền' },
    { label: 'Chênh lệch', value: formatVndPlain(recognizedMinusNet(t.recognized, t.net)), tone: 'amber', sub: 'Chưa thu hoặc thu kỳ khác' },
    { label: 'Chiết khấu đã cho', value: formatVndPlain(t.discount), tone: 'slate', sub: 'Đã nằm trong ghi nhận' },
    { label: 'Hoàn tiền', value: formatVndPlain(t.refunded), tone: 'rose', sub: 'Đã trừ khỏi thực thu' },
  ];
}

function Body({ report, from, to }: { report: RevenueByPeriodReport; from: string; to: string }) {
  const label = REVENUE_GROUP_BY_LABEL[report.groupBy];
  const t = report.totals;
  const hasData = t.recognized !== 0 || t.net !== 0 || t.refunded !== 0;
  if (!hasData) {
    return <EmptyState icon={ChartBar} title="Chưa có doanh thu trong kỳ" description="Không có phiếu thu nào được ghi nhận hay thu tiền trong kỳ đã chọn. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu doanh thu theo kỳ" />
      <ReportCard title={`Ghi nhận và Thực thu theo ${label.toLowerCase()}`} hint="Triệu đồng">
        <RevenueBarChart data={report.rows} ariaLabel={`Cột Ghi nhận và Thực thu theo từng ${label.toLowerCase()}`} />
      </ReportCard>
      <ReportCard title={`Chi tiết theo ${label.toLowerCase()}, ${periodCaption({ from, to })}`} hint="Đồng">
        <ReportGridTable
          ariaLabel="Doanh thu theo kỳ"
          minWidth={1180}
          groupHeaders={[
            { span: 1 },
            { span: 5, label: 'GHI NHẬN · theo ngày khám, đã trừ chiết khấu', tone: 'slate' },
            { span: 1 },
            { span: 2, label: 'THỰC THU · theo ngày thu', tone: 'green' },
            { span: 1 },
          ]}
          columns={[
            { header: label, width: '110px' },
            ...REVENUE_GROUP_ORDER.map((g) => ({ header: REVENUE_GROUP_LABEL[g], align: 'right' as const, width: 'minmax(104px, 1fr)' })),
            { header: 'Tổng ghi nhận', align: 'right', width: 'minmax(110px, 1.1fr)' },
            { header: 'Chiết khấu', align: 'right', width: 'minmax(96px, 1fr)' },
            { header: 'Hoàn tiền', align: 'right', width: 'minmax(96px, 1fr)' },
            { header: 'Thực thu', align: 'right', width: 'minmax(110px, 1.1fr)' },
            { header: 'So kỳ trước', align: 'right', width: '96px' },
          ]}
          rows={report.rows.map((r) => [
            <span key="l" className="font-semibold text-slate-900">{r.label}</span>,
            ...REVENUE_GROUP_ORDER.map((g) => formatVndPlain(r.byGroup[g])),
            <span key="g" className="font-semibold text-slate-900">{formatVndPlain(r.recognized)}</span>,
            <span key="d" className="text-slate-600">{formatVndPlain(r.discount)}</span>,
            <span key="f" className={r.refunded > 0 ? 'text-rose-700' : 'text-slate-600'}>{formatVndPlain(r.refunded)}</span>,
            <span key="n" className="font-semibold text-emerald-700">{formatVndPlain(r.net)}</span>,
            <span key="p" className={deltaToneClass(r.netDeltaPercent)}>{formatDeltaPercent(r.netDeltaPercent)}</span>,
          ])}
          footer={[
            `Cộng ${report.rows.length} ${label.toLowerCase()}`,
            ...REVENUE_GROUP_ORDER.map((g) => formatVndPlain(t.byGroup[g])),
            formatVndPlain(t.recognized),
            formatVndPlain(t.discount),
            <span key="f" className="text-rose-700">{formatVndPlain(t.refunded)}</span>,
            <span key="n" className="text-emerald-700">{formatVndPlain(t.net)}</span>,
            '',
          ]}
          maxBodyHeightClass="max-h-[520px]"
        />
      </ReportCard>
    </>
  );
}

/** Tab "Theo kỳ": hai cột Ghi nhận (theo ngày khám) và Thực thu (theo ngày thu), chia 4 nhóm, gom theo ngày/tuần/tháng/quý. */
export function RevenueByPeriodTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  const [groupBy, setGroupBy] = useState<RevenueGroupByCode>('month');
  const extraParams = useMemo(() => ({ groupBy }), [groupBy]);
  return (
    <PeriodReportTab<RevenueByPeriodReport, RevenueByPeriodParams>
      period={period}
      scope={scope}
      kinds={REVENUE_PERIOD_KINDS}
      extraParams={extraParams}
      controls={
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-slate-800">Gom theo</span>
          <SegmentedToggle<RevenueGroupByCode> items={REVENUE_GROUP_BY_ITEMS} value={groupBy} onChange={setGroupBy} ariaLabel="Gom doanh thu theo" />
        </div>
      }
      exportFile={(p) => exportRevenueExcel('by-period', p)}
      useReport={useRevenueByPeriodQuery}
      buildPrint={buildRevenueByPeriodPrintSpec}
      errorMessage="Không tải được báo cáo doanh thu theo kỳ."
    >
      {(report) => <Body report={report} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}
