import { useMemo } from 'react';
import { Pill } from '@phosphor-icons/react';
import type { PharmacyMarginReport } from '@nexamed/shared';
import { formatVndPlain } from '../../../shared/format/currency';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { periodCaption } from '../report-period';
import { exportPharmacyExcel, type PharmacyPeriodParams } from './pharmacy.api';
import { usePharmacyMarginQuery } from './pharmacy.queries';
import { formatMarginPercent, formatQuantity, marginBarPercent, PHARMACY_ITEM_TYPE_LABEL, truncatedNote, type PharmacyItemFilter } from './pharmacy-model';
import { buildPharmacyMarginPrintSpec } from './pharmacy-print-builders';
import type { PharmacyFilterState } from './PharmacyItemFilter';

function kpis(report: PharmacyMarginReport): ReportKpiItem[] {
  const t = report.totals;
  return [
    { label: 'Tiền bán', value: formatVndPlain(t.sell), tone: 'default', sub: 'sau chiết khấu' },
    { label: 'Giá vốn', value: formatVndPlain(t.cost), tone: 'slate', sub: 'theo thẻ kho' },
    { label: 'Lãi gộp', value: formatVndPlain(t.margin), tone: 'green', sub: 'tiền bán trừ giá vốn' },
    { label: 'Biên lãi gộp', value: formatMarginPercent(t.marginPercent), tone: 'teal', sub: 'lãi gộp chia tiền bán' },
  ];
}

function Body({ report, from, to }: { report: PharmacyMarginReport; from: string; to: string }) {
  const t = report.totals;
  if (report.rows.length === 0) {
    return <EmptyState icon={Pill} title="Chưa bán thuốc hay vật tư trong kỳ" description="Không có phiếu thu nào có thuốc hoặc vật tư trong kỳ đã chọn. Đổi kỳ, Loại hoặc phạm vi chi nhánh." />;
  }
  const maxPercent = Math.max(0, ...report.rows.map((r) => r.marginPercent ?? 0));
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu lãi gộp thuốc và vật tư" />
      <ReportCard title={`Mặt hàng, xếp theo lãi gộp, ${periodCaption({ from, to })}`} hint={truncatedNote(report.rows.length, t.itemCount, 'mặt hàng')}>
        <ReportGridTable
          ariaLabel="Lãi gộp theo mặt hàng"
          minWidth={1050}
          columns={[
            { header: 'Mặt hàng', width: 'minmax(200px, 1.4fr)' },
            { header: 'Loại', width: '80px' },
            { header: 'ĐVT', width: '70px' },
            { header: 'Số lượng', align: 'right', width: '90px' },
            { header: 'Tiền bán', align: 'right', width: '120px' },
            { header: 'Giá vốn', align: 'right', width: '120px' },
            { header: 'Lãi gộp', align: 'right', width: '120px' },
            { header: 'Biên lãi gộp', width: 'minmax(150px, 1fr)' },
          ]}
          rows={report.rows.map((r) => [
            <span key="n" className="font-semibold text-slate-900">{r.name}</span>,
            <span key="t" className="text-slate-700">{PHARMACY_ITEM_TYPE_LABEL[r.itemType]}</span>,
            <span key="u" className="text-slate-700">{r.unitName || '—'}</span>,
            formatQuantity(r.quantity),
            formatVndPlain(r.sell),
            <span key="c" className="text-slate-600">{formatVndPlain(r.cost)}</span>,
            <span key="m" className={`font-semibold ${r.margin < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatVndPlain(r.margin)}</span>,
            <div key="p" className="grid grid-cols-[minmax(0,1fr)_52px] items-center gap-x-2">
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-teal-700" style={{ width: `${marginBarPercent(r.marginPercent, maxPercent)}%` }} />
              </div>
              <span className="text-right font-semibold tabular-nums">{formatMarginPercent(r.marginPercent)}</span>
            </div>,
          ])}
          footer={[`Cộng ${formatQuantity(t.itemCount)} mặt hàng`, '', '', '', formatVndPlain(t.sell), formatVndPlain(t.cost), formatVndPlain(t.margin), formatMarginPercent(t.marginPercent)]}
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
      <p className="text-[13px] text-slate-600">Lãi gộp chỉ tính tiền bán trừ giá vốn thuốc, vật tư. Chưa trừ nhân sự, mặt bằng, khấu hao.</p>
    </>
  );
}

/** Tab "Lãi gộp": tiền bán (sau chiết khấu, trừ phần hoàn) trừ giá vốn thẻ kho của từng mặt hàng; lọc Loại Tất cả / Thuốc / Vật tư y tế. */
export function PharmacyMarginTab({ period, scope, filter }: { period: ReportPeriodState; scope: ReportScopeState; filter: PharmacyFilterState }) {
  const extraParams = useMemo(() => ({ itemType: filter.itemType as PharmacyItemFilter }), [filter.itemType]);
  return (
    <PeriodReportTab<PharmacyMarginReport, PharmacyPeriodParams>
      period={period}
      scope={scope}
      controls={filter.control}
      extraParams={extraParams}
      exportFile={(p) => exportPharmacyExcel('margin', p)}
      useReport={usePharmacyMarginQuery}
      buildPrint={buildPharmacyMarginPrintSpec}
      errorMessage="Không tải được báo cáo lãi gộp thuốc và vật tư."
    >
      {(report) => <Body report={report} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}
