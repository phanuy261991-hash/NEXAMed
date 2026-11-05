import { useMemo } from 'react';
import { Pill } from '@phosphor-icons/react';
import type { PharmacyDispensedReport } from '@nexamed/shared';
import { formatVndPlain } from '../../../shared/format/currency';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { periodCaption } from '../report-period';
import { exportPharmacyExcel, type PharmacyPeriodParams } from './pharmacy.api';
import { usePharmacyDispensedQuery } from './pharmacy.queries';
import { formatQuantity, PHARMACY_ITEM_TYPE_LABEL, truncatedNote, type PharmacyItemFilter } from './pharmacy-model';
import { buildPharmacyDispensedPrintSpec } from './pharmacy-print-builders';
import type { PharmacyFilterState } from './PharmacyItemFilter';

function kpis(report: PharmacyDispensedReport): ReportKpiItem[] {
  return [
    { label: 'Mặt hàng đã phát', value: formatQuantity(report.itemCount), tone: 'blue', sub: 'có xuất trong kỳ' },
    { label: 'Phiếu xuất kho', value: formatQuantity(report.issueCount), sub: 'bán theo đơn, đã ghi sổ' },
    { label: 'Giá trị thực phát', value: formatVndPlain(report.amount), tone: 'green', sub: 'theo giá bán, trước chiết khấu' },
    { label: 'Khách trả lại', value: formatVndPlain(report.returnedAmount), tone: 'rose', sub: 'đã trừ khỏi thực phát' },
  ];
}

function Body({ report, from, to }: { report: PharmacyDispensedReport; from: string; to: string }) {
  if (report.rows.length === 0) {
    return <EmptyState icon={Pill} title="Chưa phát thuốc hay vật tư trong kỳ" description="Không có phiếu xuất kho bán theo đơn nào trong kỳ đã chọn. Đổi kỳ, Loại hoặc phạm vi chi nhánh." />;
  }
  const max = Math.max(0, ...report.rows.map((r) => r.amount));
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu thuốc và vật tư đã phát" />
      <ReportCard title={`Mặt hàng đã phát, xếp theo giá trị, ${periodCaption({ from, to })}`} hint={truncatedNote(report.rows.length, report.itemCount, 'mặt hàng')}>
        <ReportGridTable
          ariaLabel="Thuốc và vật tư đã phát theo mặt hàng"
          minWidth={1050}
          columns={[
            { header: 'Mặt hàng', width: 'minmax(200px, 1.4fr)' },
            { header: 'Loại', width: '80px' },
            { header: 'ĐVT', width: '70px' },
            { header: 'Đã xuất', align: 'right', width: '84px' },
            { header: 'Khách trả lại', align: 'right', width: '104px' },
            { header: 'Thực phát', align: 'right', width: '90px' },
            { header: 'Số phiếu', align: 'right', width: '78px' },
            { header: 'Giá trị thực phát', width: 'minmax(190px, 1.2fr)' },
          ]}
          rows={report.rows.map((r) => [
            <span key="n" className="font-semibold text-slate-900">{r.name}</span>,
            <span key="t" className="text-slate-700">{PHARMACY_ITEM_TYPE_LABEL[r.itemType]}</span>,
            <span key="u" className="text-slate-700">{r.unitName || '—'}</span>,
            formatQuantity(r.quantity),
            r.returnedQuantity > 0 ? <span key="r" className="text-rose-700">{formatQuantity(r.returnedQuantity)}</span> : '—',
            <span key="s" className="font-semibold">{formatQuantity(r.netQuantity)}</span>,
            formatQuantity(r.issueCount),
            <div key="a" className="grid grid-cols-[minmax(0,1fr)_104px] items-center gap-x-2.5">
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-blue-700" style={{ width: `${barWidthPercent(r.amount, max)}%` }} />
              </div>
              <span className="text-right font-semibold tabular-nums text-slate-900">{formatVndPlain(r.amount)}</span>
            </div>,
          ])}
          footer={[`Cộng ${formatQuantity(report.itemCount)} mặt hàng`, '', '', '', '', '', '', formatVndPlain(report.amount)]}
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
      <p className="text-[13px] text-slate-600">Số lượng theo đơn vị cơ sở của từng mặt hàng nên không cộng được giữa các dòng.</p>
    </>
  );
}

/** Tab "Đã phát": thuốc và vật tư đã xuất theo phiếu xuất kho bán theo đơn, trừ phần khách trả lại. */
export function PharmacyDispensedTab({ period, scope, filter }: { period: ReportPeriodState; scope: ReportScopeState; filter: PharmacyFilterState }) {
  const extraParams = useMemo(() => ({ itemType: filter.itemType as PharmacyItemFilter }), [filter.itemType]);
  return (
    <PeriodReportTab<PharmacyDispensedReport, PharmacyPeriodParams>
      period={period}
      scope={scope}
      controls={filter.control}
      extraParams={extraParams}
      exportFile={(p) => exportPharmacyExcel('dispensed', p)}
      useReport={usePharmacyDispensedQuery}
      buildPrint={buildPharmacyDispensedPrintSpec}
      errorMessage="Không tải được báo cáo thuốc và vật tư đã phát."
    >
      {(report) => <Body report={report} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}
