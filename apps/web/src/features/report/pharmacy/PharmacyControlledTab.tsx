import { useMemo } from 'react';
import { ShieldWarning } from '@phosphor-icons/react';
import type { PharmacyControlledReport } from '@nexamed/shared';
import { formatDobDisplay } from '../../../shared/format/date';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { periodCaption } from '../report-period';
import { exportControlledExcel, type ControlledPeriodParams } from './pharmacy.api';
import { usePharmacyControlledQuery } from './pharmacy.queries';
import { CONTROLLED_TYPE_LABEL, CONTROLLED_TYPE_TONE, formatQuantity, truncatedNote, type ControlledTypeFilter } from './pharmacy-model';
import { buildPharmacyControlledPrintSpec } from './pharmacy-print-builders';
import type { ControlledFilterState } from './PharmacyItemFilter';

function kpis(report: PharmacyControlledReport): ReportKpiItem[] {
  const dispensedItems = report.rows.filter((r) => r.dispensedQuantity > 0).length;
  return [
    { label: 'Mặt hàng kiểm soát', value: formatQuantity(report.itemCount), tone: 'blue', sub: 'có tồn hoặc biến động trong kỳ' },
    { label: 'Mặt hàng đã phát', value: formatQuantity(dispensedItems), sub: 'cho người bệnh trong kỳ' },
    { label: 'Lượt phát', value: formatQuantity(report.entryCount), tone: 'rose', sub: 'theo phiếu xuất kho bán theo đơn' },
  ];
}

function Body({ report, from, to }: { report: PharmacyControlledReport; from: string; to: string }) {
  if (report.rows.length === 0 && report.entries.length === 0) {
    return (
      <EmptyState
        icon={ShieldWarning}
        title="Không có thuốc kiểm soát đặc biệt trong kỳ"
        description="Chưa có thuốc gây nghiện, hướng thần, tiền chất hoặc thuốc độc nào có tồn hay biến động trong kỳ đã chọn. Đổi kỳ, Phân loại hoặc phạm vi chi nhánh."
      />
    );
  }
  const multiBranch = report.branchCount > 1;
  const caption = periodCaption({ from, to });
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu thuốc kiểm soát đặc biệt" />
      <ReportCard title={`Tồn kho và biến động, ${caption}`} hint="Đơn vị cơ sở">
        <ReportGridTable
          ariaLabel="Tồn kho và biến động thuốc kiểm soát đặc biệt"
          minWidth={1000}
          columns={[
            { header: 'Mặt hàng', width: 'minmax(200px, 1.4fr)' },
            { header: 'Phân loại', width: '100px' },
            { header: 'ĐVT', width: '70px' },
            { header: 'Tồn đầu kỳ', align: 'right', width: '100px' },
            { header: 'Nhập', align: 'right', width: '84px' },
            { header: 'Phát cho người bệnh', align: 'right', width: '150px' },
            { header: 'Xuất khác', align: 'right', width: '90px' },
            { header: 'Tồn cuối kỳ', align: 'right', width: '104px' },
          ]}
          rows={report.rows.map((r) => [
            <span key="n" className="font-semibold text-slate-900">{r.name}</span>,
            <span key="c" className={`font-semibold ${CONTROLLED_TYPE_TONE[r.controlType]}`}>{CONTROLLED_TYPE_LABEL[r.controlType]}</span>,
            <span key="u" className="text-slate-700">{r.unitName || '—'}</span>,
            formatQuantity(r.openingQuantity),
            formatQuantity(r.receivedQuantity),
            formatQuantity(r.dispensedQuantity),
            formatQuantity(r.otherOutQuantity),
            <span key="e" className="font-semibold">{formatQuantity(r.closingQuantity)}</span>,
          ])}
          emptyText="Không có thuốc kiểm soát đặc biệt nào có tồn hoặc biến động trong kỳ."
        />
      </ReportCard>
      <ReportCard title={`Từng lượt phát cho người bệnh, ${caption}`} hint={truncatedNote(report.entries.length, report.entryCount, 'lượt')}>
        <ReportGridTable
          ariaLabel="Từng lượt phát thuốc kiểm soát đặc biệt"
          minWidth={multiBranch ? 1150 : 1000}
          columns={[
            { header: 'Ngày', width: '96px' },
            { header: 'Số phiếu xuất', width: '150px' },
            { header: 'Mặt hàng', width: 'minmax(180px, 1.3fr)' },
            { header: 'Phân loại', width: '100px' },
            { header: 'Số lượng', align: 'right', width: '84px' },
            { header: 'Mã bệnh nhân', width: '120px' },
            { header: 'Họ tên', width: 'minmax(150px, 1fr)' },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: '130px' }] : []),
          ]}
          rows={report.entries.map((e) => [
            formatDobDisplay(e.date),
            <span key="no" className="tabular-nums">{e.issueNo}</span>,
            <span key="d" className="font-semibold text-slate-900">{e.drugName}</span>,
            <span key="c" className={`font-semibold ${CONTROLLED_TYPE_TONE[e.controlType]}`}>{CONTROLLED_TYPE_LABEL[e.controlType]}</span>,
            `${formatQuantity(e.quantity)} ${e.unitName}`.trim(),
            e.patientCode,
            e.patientName,
            ...(multiBranch ? [e.branchName] : []),
          ])}
          emptyText="Không có lượt phát nào trong kỳ."
          maxBodyHeightClass="max-h-[420px]"
        />
      </ReportCard>
    </>
  );
}

/** Tab "Kiểm soát đặc biệt": tồn đầu kỳ, nhập, phát, xuất khác, tồn cuối kỳ của thuốc gây nghiện, hướng thần, tiền chất, thuốc độc và từng lượt phát cho người bệnh. */
export function PharmacyControlledTab({ period, scope, filter }: { period: ReportPeriodState; scope: ReportScopeState; filter: ControlledFilterState }) {
  const extraParams = useMemo(() => ({ controlType: filter.controlType as ControlledTypeFilter }), [filter.controlType]);
  return (
    <PeriodReportTab<PharmacyControlledReport, ControlledPeriodParams>
      period={period}
      scope={scope}
      controls={filter.control}
      extraParams={extraParams}
      exportFile={exportControlledExcel}
      useReport={usePharmacyControlledQuery}
      buildPrint={buildPharmacyControlledPrintSpec}
      errorMessage="Không tải được báo cáo thuốc kiểm soát đặc biệt."
    >
      {(report) => <Body report={report} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}
