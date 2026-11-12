import { useMemo, type ReactNode } from 'react';
import { Package } from '@phosphor-icons/react';
import type { ServiceConsumptionByCustomerReport, ServiceConsumptionByServiceReport } from '@nexamed/shared';
import { formatVnd, formatVndPlain } from '../../../shared/format/currency';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import { periodCaption } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportServiceConsumptionExcel, type ServiceConsumptionPeriodParams } from './service-consumption-report.api';
import { useServiceConsumptionByCustomerQuery, useServiceConsumptionByServiceQuery } from './service-consumption-report.queries';
import {
  buildServiceConsumptionByCustomerPrintSpec,
  buildServiceConsumptionByServicePrintSpec,
  formatConsumptionDateTime,
  truncatedNote,
} from './service-consumption-report-model';

interface SummaryFields {
  totalCost: number;
  visitCount: number;
  averageCost: number | null;
}

/** Ba ô tổng đầu trang (mockup màn 9). */
function kpis(r: SummaryFields): ReportKpiItem[] {
  return [
    { label: 'Tổng chi phí vốn', value: formatVnd(r.totalCost), tone: 'blue', sub: 'Vật tư và thuốc đã dùng trong kỳ' },
    { label: 'Số lượt dịch vụ', value: r.visitCount.toLocaleString('vi-VN'), sub: 'Lượt có ghi tiêu hao' },
    { label: 'Chi phí trung bình mỗi lượt', value: r.averageCost === null ? '—' : formatVnd(r.averageCost), sub: 'Tổng chi phí chia số lượt' },
  ];
}

const FILTER_HINT = 'Đổi kỳ, dịch vụ, bác sĩ hoặc phạm vi chi nhánh.';

function Empty(): ReactNode {
  return <EmptyState icon={Package} title="Chưa có vật tư hay thuốc tiêu hao trong kỳ" description={`Không có lượt dịch vụ nào ghi tiêu hao. ${FILTER_HINT}`} />;
}

function ByServiceBody({ report, from, to }: { report: ServiceConsumptionByServiceReport; from: string; to: string }) {
  if (report.rows.length === 0) return <Empty />;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu chi phí vật tư theo dịch vụ" />
      <ReportCard title={`Chi phí theo dịch vụ, xếp theo chi phí vốn, ${periodCaption({ from, to })}`} hint={truncatedNote(report.rows.length, report.serviceCount, 'dịch vụ')}>
        <ReportGridTable
          ariaLabel="Chi phí vật tư theo dịch vụ"
          minWidth={820}
          columns={[
            { header: 'Dịch vụ', width: 'minmax(200px, 1.4fr)' },
            { header: 'Số lượt', align: 'right', width: '90px' },
            { header: 'Chi phí vốn', align: 'right', width: '130px' },
            { header: 'Trung bình / lượt', align: 'right', width: '140px' },
            { header: 'Dùng nhiều nhất', width: 'minmax(200px, 1.2fr)' },
          ]}
          rows={report.rows.map((r) => [
            <span key="n" className="font-semibold text-slate-900">{r.name}</span>,
            r.visitCount.toLocaleString('vi-VN'),
            <span key="c" className="font-semibold">{formatVndPlain(r.cost)}</span>,
            r.averageCost === null ? '—' : formatVndPlain(r.averageCost),
            <span key="t" className="text-slate-700">{r.topItems.join(', ') || '—'}</span>,
          ])}
          footer={[`Cộng ${report.serviceCount.toLocaleString('vi-VN')} dịch vụ`, report.visitCount.toLocaleString('vi-VN'), formatVndPlain(report.totalCost), report.averageCost === null ? '—' : formatVndPlain(report.averageCost), '']}
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
    </>
  );
}

function ByCustomerBody({ report, from, to }: { report: ServiceConsumptionByCustomerReport; from: string; to: string }) {
  if (report.entries.length === 0) return <Empty />;
  const multiBranch = report.branchCount > 1;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu chi phí vật tư theo khách" />
      <ReportCard title={`Từng lượt dịch vụ của từng khách, mới nhất trước, ${periodCaption({ from, to })}`} hint={truncatedNote(report.entries.length, report.entryCount, 'lượt')}>
        <ReportGridTable
          ariaLabel="Chi phí vật tư theo khách"
          minWidth={multiBranch ? 1250 : 1120}
          columns={[
            { header: 'Ngày', width: '132px' },
            { header: 'Khách', width: 'minmax(150px, 1fr)' },
            { header: 'Dịch vụ', width: 'minmax(140px, 1fr)' },
            { header: 'Vật tư và thuốc đã dùng', width: 'minmax(220px, 1.6fr)' },
            { header: 'Bác sĩ', width: '130px' },
            { header: 'Người thực hiện', width: '130px' },
            { header: 'Chi phí vốn', align: 'right', width: '104px' },
            ...(multiBranch ? [{ header: 'Chi nhánh', width: '120px' }] : []),
          ]}
          rows={report.entries.map((e) => [
            formatConsumptionDateTime(e.occurredAt),
            <div key="p">
              <div className="font-semibold text-slate-900">{e.patientName}</div>
              <div className="text-xs text-slate-600">{e.patientCode}</div>
            </div>,
            e.serviceName,
            <span key="i" className="text-slate-700">{e.itemsText}</span>,
            e.doctorName ?? '—',
            e.performerName ?? '—',
            <span key="c" className="font-semibold">{formatVndPlain(e.cost)}</span>,
            ...(multiBranch ? [e.branchName] : []),
          ])}
          footer={['Cộng', '', '', '', '', '', formatVndPlain(report.totalCost), ...(multiBranch ? [''] : [])]}
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
    </>
  );
}

export interface ServiceConsumptionFilter {
  serviceKey: string;
  doctorId: string;
  control: ReactNode;
}

function useExtraParams(filter: ServiceConsumptionFilter) {
  return useMemo(() => ({ ...(filter.serviceKey ? { serviceKey: filter.serviceKey } : {}), ...(filter.doctorId ? { doctorId: filter.doctorId } : {}) }), [filter.serviceKey, filter.doctorId]);
}

/** Tab "Theo dịch vụ": số lượt, chi phí vốn, trung bình mỗi lượt và mặt hàng dùng nhiều nhất của từng dịch vụ. */
export function ServiceConsumptionByServiceTab({ period, scope, filter }: { period: ReportPeriodState; scope: ReportScopeState; filter: ServiceConsumptionFilter }) {
  const extraParams = useExtraParams(filter);
  return (
    <PeriodReportTab<ServiceConsumptionByServiceReport, ServiceConsumptionPeriodParams>
      period={period}
      scope={scope}
      controls={filter.control}
      extraParams={extraParams}
      exportFile={(p) => exportServiceConsumptionExcel('by-service', p)}
      useReport={useServiceConsumptionByServiceQuery}
      buildPrint={buildServiceConsumptionByServicePrintSpec}
      errorMessage="Không tải được báo cáo chi phí vật tư theo dịch vụ."
    >
      {(report) => <ByServiceBody report={report} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}

/** Tab "Theo khách": từng lượt dịch vụ của từng khách kèm vật tư đã dùng và chi phí vốn. */
export function ServiceConsumptionByCustomerTab({ period, scope, filter }: { period: ReportPeriodState; scope: ReportScopeState; filter: ServiceConsumptionFilter }) {
  const extraParams = useExtraParams(filter);
  return (
    <PeriodReportTab<ServiceConsumptionByCustomerReport, ServiceConsumptionPeriodParams>
      period={period}
      scope={scope}
      controls={filter.control}
      extraParams={extraParams}
      exportFile={(p) => exportServiceConsumptionExcel('by-customer', p)}
      useReport={useServiceConsumptionByCustomerQuery}
      buildPrint={buildServiceConsumptionByCustomerPrintSpec}
      errorMessage="Không tải được báo cáo chi phí vật tư theo khách."
    >
      {(report) => <ByCustomerBody report={report} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}
