import { useMemo, type ReactNode } from 'react';
import { Package } from '@phosphor-icons/react';
import type { ServiceConsumptionByBranchReport, ServiceConsumptionByCustomerReport, ServiceConsumptionByItemReport, ServiceConsumptionByServiceReport } from '@nexamed/shared';
import { formatVnd, formatVndPlain } from '../../../shared/format/currency';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { formatDobDisplay } from '../../../shared/format/date';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatPercent } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import { periodCaption } from '../report-period';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportServiceConsumptionExcel, type ServiceConsumptionPeriodParams } from './service-consumption-report.api';
import {
  useServiceConsumptionByBranchQuery,
  useServiceConsumptionByCustomerQuery,
  useServiceConsumptionByItemQuery,
  useServiceConsumptionByServiceQuery,
} from './service-consumption-report.queries';
import {
  buildServiceConsumptionByBranchPrintSpec,
  buildServiceConsumptionByCustomerPrintSpec,
  buildServiceConsumptionByItemPrintSpec,
  buildServiceConsumptionByServicePrintSpec,
  describeItemServices,
  formatConsumptionDateTime,
  formatItemQuantity,
  truncatedNote,
} from './service-consumption-report-model';

interface SummaryFields {
  totalCost: number;
  totalRevenue: number;
  totalMargin: number;
  marginPercent: number | null;
  visitCount: number;
  averageCost: number | null;
}

/** Lãi gộp dương màu teal như "Lãi gộp thuốc"; âm (lượt hoàn tiền mà vật tư đã hao) màu đỏ. */
function marginClass(value: number): string {
  return value < 0 ? 'text-rose-700' : 'text-teal-700';
}

/** Năm ô tổng đầu trang (mockup chốt 12/11/2026): chi phí, doanh thu, lãi gộp, số lượt, chi phí trung bình mỗi lượt. */
function kpis(r: SummaryFields): ReportKpiItem[] {
  return [
    { label: 'Tổng chi phí vốn', value: formatVnd(r.totalCost), tone: 'blue', sub: 'Vật tư và thuốc đã dùng trong kỳ' },
    { label: 'Doanh thu dịch vụ', value: formatVnd(r.totalRevenue), sub: 'Ghi nhận, lượt đã ghi vật tư' },
    { label: 'Lãi gộp dịch vụ', value: formatVnd(r.totalMargin), tone: r.totalMargin < 0 ? 'rose' : 'teal', sub: `Biên lãi gộp ${formatPercent(r.marginPercent)}` },
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
          minWidth={1080}
          columns={[
            { header: 'Dịch vụ', width: 'minmax(190px, 1.3fr)' },
            { header: 'Số lượt', align: 'right', width: '70px' },
            { header: 'Doanh thu', align: 'right', width: '124px' },
            { header: 'Chi phí vốn', align: 'right', width: '118px' },
            { header: 'Trung bình / lượt', align: 'right', width: '118px' },
            { header: 'Lãi gộp', align: 'right', width: '124px' },
            { header: 'Biên', align: 'right', width: '72px' },
            { header: 'Dùng nhiều nhất', width: 'minmax(180px, 1.2fr)' },
          ]}
          rows={report.rows.map((r) => [
            <span key="n" className="font-semibold text-slate-900">{r.name}</span>,
            r.visitCount.toLocaleString('vi-VN'),
            formatVndPlain(r.revenue),
            <span key="c" className="font-semibold">{formatVndPlain(r.cost)}</span>,
            r.averageCost === null ? '—' : formatVndPlain(r.averageCost),
            <span key="m" className={`font-semibold ${marginClass(r.margin)}`}>{formatVndPlain(r.margin)}</span>,
            <span key="p" className="text-slate-600">{formatPercent(r.marginPercent)}</span>,
            <span key="t" className="text-slate-700">{r.topItems.join(', ') || '—'}</span>,
          ])}
          footer={[
            `Cộng ${report.serviceCount.toLocaleString('vi-VN')} dịch vụ`,
            report.visitCount.toLocaleString('vi-VN'),
            formatVndPlain(report.totalRevenue),
            formatVndPlain(report.totalCost),
            report.averageCost === null ? '—' : formatVndPlain(report.averageCost),
            <span key="m" className={marginClass(report.totalMargin)}>{formatVndPlain(report.totalMargin)}</span>,
            formatPercent(report.marginPercent),
            '',
          ]}
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
          minWidth={multiBranch ? 1320 : 1200}
          columns={[
            { header: 'Ngày', width: '120px' },
            { header: 'Khách', width: 'minmax(150px, 1fr)' },
            { header: 'Dịch vụ', width: 'minmax(140px, 1fr)' },
            { header: 'Vật tư và thuốc đã dùng', width: 'minmax(210px, 1.5fr)' },
            { header: 'Bác sĩ', width: '120px' },
            { header: 'Doanh thu', align: 'right', width: '112px' },
            { header: 'Chi phí vốn', align: 'right', width: '100px' },
            { header: 'Lãi gộp', align: 'right', width: '112px' },
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
            <div key="r">
              <div>{formatVndPlain(e.revenue)}</div>
              {e.refunded && <StatusBadge tone="accent">Đã hoàn tiền</StatusBadge>}
            </div>,
            <span key="c" className="font-semibold">{formatVndPlain(e.cost)}</span>,
            <span key="m" className={`font-semibold ${marginClass(e.margin)}`}>{formatVndPlain(e.margin)}</span>,
            ...(multiBranch ? [e.branchName] : []),
          ])}
          footer={[
            'Cộng',
            '',
            '',
            '',
            '',
            formatVndPlain(report.totalRevenue),
            formatVndPlain(report.totalCost),
            <span key="m" className={marginClass(report.totalMargin)}>{formatVndPlain(report.totalMargin)}</span>,
            ...(multiBranch ? [''] : []),
          ]}
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
    </>
  );
}

/** Ba ô tổng của tab Theo vật tư (mockup): tổng chi phí, số mặt hàng đã dùng, mặt hàng tốn nhất. */
function itemKpis(r: ServiceConsumptionByItemReport): ReportKpiItem[] {
  return [
    { label: 'Tổng chi phí vốn', value: formatVnd(r.totalCost), tone: 'blue', sub: 'Vật tư và thuốc đã dùng trong kỳ' },
    { label: 'Số mặt hàng đã dùng', value: r.itemCount.toLocaleString('vi-VN'), sub: `${r.supplyCount.toLocaleString('vi-VN')} vật tư, ${r.medicineCount.toLocaleString('vi-VN')} thuốc` },
    { label: 'Mặt hàng tốn nhất', value: r.topItem?.name ?? '—', sub: r.topItem ? `${formatPercent(r.topItem.sharePercent)} tổng chi phí` : undefined },
  ];
}

function ByItemBody({ report, from, to }: { report: ServiceConsumptionByItemReport; from: string; to: string }) {
  if (report.rows.length === 0) return <Empty />;
  const maxShare = Math.max(0, ...report.rows.map((r) => r.sharePercent ?? 0));
  return (
    <>
      <ReportKpiStrip items={itemKpis(report)} ariaLabel="Số liệu chi phí vật tư theo vật tư" />
      <ReportCard title={`Chi phí theo mặt hàng, xếp theo chi phí vốn, ${periodCaption({ from, to })}`} hint={truncatedNote(report.rows.length, report.itemCount, 'mặt hàng')}>
        <ReportGridTable
          ariaLabel="Chi phí vật tư theo vật tư"
          minWidth={1060}
          columns={[
            { header: 'Mặt hàng', width: 'minmax(220px, 1.4fr)' },
            { header: 'Dùng ở', width: 'minmax(190px, 1.2fr)' },
            { header: 'Số lượng', align: 'right', width: '120px' },
            { header: 'Giá vốn TB / đơn vị', align: 'right', width: '140px' },
            { header: 'Chi phí vốn', align: 'right', width: '124px' },
            { header: 'Tỷ trọng', width: 'minmax(170px, 1fr)' },
          ]}
          rows={report.rows.map((r) => [
            <div key="n">
              <div className="font-semibold text-slate-900">{r.name}</div>
              <div className="text-xs text-slate-600">{r.itemType === 'MEDICINE' ? 'Thuốc' : 'Vật tư'}</div>
            </div>,
            <span key="s" className="text-slate-700">{describeItemServices(r.serviceNames, r.serviceCount)}</span>,
            formatItemQuantity(r.quantity, r.unitName),
            r.averageUnitCost === null ? '—' : formatVndPlain(r.averageUnitCost),
            <span key="c" className="font-semibold">{formatVndPlain(r.cost)}</span>,
            <div key="b" className="grid grid-cols-[minmax(0,1fr)_48px] items-center gap-x-2">
              <div className="h-2.5 rounded-full bg-slate-100">
                <div className="h-2.5 rounded-full bg-blue-600" style={{ width: `${barWidthPercent(r.sharePercent ?? 0, maxShare)}%` }} />
              </div>
              <span className="text-right text-slate-600">{formatPercent(r.sharePercent)}</span>
            </div>,
          ])}
          footer={[`Cộng ${report.itemCount.toLocaleString('vi-VN')} mặt hàng`, '', '', '', formatVndPlain(report.totalCost), report.totalCost > 0 ? '100%' : '—']}
          maxBodyHeightClass="max-h-[560px]"
        />
      </ReportCard>
    </>
  );
}

function ByBranchBody({ report, scope, from, to }: { report: ServiceConsumptionByBranchReport; scope: ReportScopeState; from: string; to: string }) {
  if (report.rows.length === 0) return <Empty />;
  const canDrill = report.rows.length > 1 && scope.canChoose;
  return (
    <>
      <p className="text-[13px] text-slate-600">
        Đang xem: {report.rows.map((r) => r.branchName).join(', ')} · {formatDobDisplay(from)} – {formatDobDisplay(to)}
      </p>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu chi phí vật tư theo chi nhánh" />
      <ReportCard title="Chi phí vật tư từng chi nhánh" hint={canDrill ? 'Bấm tên chi nhánh để xem riêng' : undefined}>
        <ReportGridTable
          ariaLabel="Chi phí vật tư theo chi nhánh"
          minWidth={960}
          columns={[
            { header: 'Chi nhánh', width: 'minmax(180px, 1.4fr)' },
            { header: 'Số lượt', align: 'right', width: '80px' },
            { header: 'Doanh thu', align: 'right', width: '124px' },
            { header: 'Chi phí vốn', align: 'right', width: '118px' },
            { header: 'Trung bình / lượt', align: 'right', width: '130px' },
            { header: 'Lãi gộp', align: 'right', width: '124px' },
            { header: 'Biên', align: 'right', width: '72px' },
          ]}
          rows={report.rows.map((r) => [
            canDrill ? (
              <button key="n" type="button" onClick={() => scope.setBranchIds([r.branchId])} className="max-w-full truncate text-left font-semibold text-blue-700 hover:underline" title={r.branchName}>
                {r.branchName}
              </button>
            ) : (
              <span key="n" className="block truncate font-semibold text-slate-900" title={r.branchName}>{r.branchName}</span>
            ),
            r.visitCount.toLocaleString('vi-VN'),
            formatVndPlain(r.revenue),
            <span key="c" className="font-semibold">{formatVndPlain(r.cost)}</span>,
            r.averageCost === null ? '—' : formatVndPlain(r.averageCost),
            <span key="m" className={`font-semibold ${marginClass(r.margin)}`}>{formatVndPlain(r.margin)}</span>,
            <span key="p" className="text-slate-600">{formatPercent(r.marginPercent)}</span>,
          ])}
          footer={[
            `Cộng ${report.rows.length.toLocaleString('vi-VN')} chi nhánh`,
            report.visitCount.toLocaleString('vi-VN'),
            formatVndPlain(report.totalRevenue),
            formatVndPlain(report.totalCost),
            report.averageCost === null ? '—' : formatVndPlain(report.averageCost),
            <span key="m" className={marginClass(report.totalMargin)}>{formatVndPlain(report.totalMargin)}</span>,
            formatPercent(report.marginPercent),
          ]}
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

interface TabProps {
  period: ReportPeriodState;
  scope: ReportScopeState;
  filter: ServiceConsumptionFilter;
}

/** Tab "Theo dịch vụ": số lượt, doanh thu, chi phí vốn, lãi gộp và mặt hàng dùng nhiều nhất của từng dịch vụ. */
export function ServiceConsumptionByServiceTab({ period, scope, filter }: TabProps) {
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

/** Tab "Theo khách": từng lượt dịch vụ của từng khách kèm vật tư đã dùng, doanh thu, chi phí vốn và lãi gộp. */
export function ServiceConsumptionByCustomerTab({ period, scope, filter }: TabProps) {
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

/** Tab "Theo vật tư": từng mặt hàng đã dùng — số lượng, giá vốn trung bình, chi phí, tỷ trọng và dịch vụ dùng. */
export function ServiceConsumptionByItemTab({ period, scope, filter }: TabProps) {
  const extraParams = useExtraParams(filter);
  return (
    <PeriodReportTab<ServiceConsumptionByItemReport, ServiceConsumptionPeriodParams>
      period={period}
      scope={scope}
      controls={filter.control}
      extraParams={extraParams}
      exportFile={(p) => exportServiceConsumptionExcel('by-item', p)}
      useReport={useServiceConsumptionByItemQuery}
      buildPrint={buildServiceConsumptionByItemPrintSpec}
      errorMessage="Không tải được báo cáo chi phí vật tư theo vật tư."
    >
      {(report) => <ByItemBody report={report} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}

/** Tab "Theo chi nhánh" (chỉ khi công ty có từ 2 chi nhánh và tài khoản có quyền xem báo cáo toàn công ty): so sánh chi phí, doanh thu, lãi gộp từng chi nhánh. */
export function ServiceConsumptionByBranchTab({ period, scope, filter }: TabProps) {
  const extraParams = useExtraParams(filter);
  return (
    <PeriodReportTab<ServiceConsumptionByBranchReport, ServiceConsumptionPeriodParams>
      period={period}
      scope={scope}
      controls={filter.control}
      extraParams={extraParams}
      exportFile={(p) => exportServiceConsumptionExcel('by-branch', p)}
      useReport={useServiceConsumptionByBranchQuery}
      buildPrint={buildServiceConsumptionByBranchPrintSpec}
      errorMessage="Không tải được báo cáo chi phí vật tư theo chi nhánh."
    >
      {(report) => <ByBranchBody report={report} scope={scope} from={period.range.from} to={period.range.to} />}
    </PeriodReportTab>
  );
}
