import { useMemo } from 'react';
import { Pill } from '@phosphor-icons/react';
import type { DoctorOrderMixReport, DoctorTopItem } from '@nexamed/shared';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatCount, formatPercent } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { DOCTOR_PERIOD_KINDS } from './DoctorPerformanceTab';
import type { DoctorFilterState } from './DoctorDepartmentFilter';
import { exportDoctorExcel, type DoctorPeriodParams } from './doctors.api';
import { useDoctorOrderMixQuery } from './doctors.queries';
import { buildDoctorOrderMixPrintSpec } from './doctors-print-builders';
import { formatDecimal } from './doctors-model';

/** Tỉ lệ phần trăm của `part` trên `whole`, một chữ số thập phân; `null` khi `whole` ≤ 0. */
const share = (part: number, whole: number): number | null => (whole <= 0 ? null : Math.round((part / whole) * 1000) / 10);

function kpis(report: DoctorOrderMixReport): ReportKpiItem[] {
  const t = report.totals;
  return [
    { label: 'Lượt khám', value: formatCount(t.visits), sub: 'đã hoàn tất' },
    { label: 'Lượt có thuốc', value: formatPercent(share(t.withPrescription, t.visits)), tone: 'blue', sub: `${formatCount(t.withPrescription)} đơn thuốc` },
    { label: 'Dòng thuốc mỗi đơn', value: formatDecimal(t.itemsPerPrescription), sub: `${formatCount(t.prescriptionItems)} dòng thuốc` },
    { label: 'Lượt có cận lâm sàng', value: formatPercent(share(t.withCls, t.visits)), tone: 'teal', sub: `${formatCount(t.withCls)} lượt` },
    { label: 'Chỉ định cận lâm sàng', value: formatCount(t.clsInHouse + t.clsExternal), sub: `${formatCount(t.clsInHouse)} tại phòng khám · ${formatCount(t.clsExternal)} ra ngoài` },
  ];
}

function TopList({ title, hint, unit, items, emptyText }: { title: string; hint: string; unit: string; items: readonly DoctorTopItem[]; emptyText: string }) {
  const max = items[0]?.count ?? 0;
  return (
    <ReportCard title={title} hint={hint}>
      <ReportGridTable
        ariaLabel={title}
        columns={[{ header: '#', width: '36px' }, { header: unit, width: 'minmax(150px, 1.6fr)' }, { header: 'Số lần', align: 'right', width: '70px' }, { header: 'Số bác sĩ', align: 'right', width: '80px' }, { header: '', width: 'minmax(80px, 0.8fr)' }]}
        rows={items.map((d, i) => [
          <span key="i" className="font-semibold text-slate-700">{i + 1}</span>,
          <span key="n" className="font-semibold text-slate-900">{d.name}</span>,
          <span key="c" className="font-semibold">{formatCount(d.count)}</span>,
          formatCount(d.doctorCount),
          <div key="b" className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${barWidthPercent(d.count, max)}%` }} />
          </div>,
        ])}
        emptyText={emptyText}
      />
    </ReportCard>
  );
}

function Body({ report }: { report: DoctorOrderMixReport }) {
  if (report.rows.length === 0) {
    return <EmptyState icon={Pill} title="Không có bác sĩ nào khám trong kỳ" description="Chưa có lượt khám đã hoàn tất nào của bác sĩ trong kỳ đã chọn. Đổi kỳ, Khoa hoặc phạm vi chi nhánh." />;
  }
  const t = report.totals;
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu cơ cấu kê đơn và chỉ định" />
      <ReportCard title="Theo bác sĩ" hint="Xếp theo số lượt khám">
        <ReportGridTable
          ariaLabel="Cơ cấu kê đơn và chỉ định theo bác sĩ"
          minWidth={1050}
          columns={[
            { header: 'Bác sĩ', width: 'minmax(150px, 1.3fr)' },
            { header: 'Khoa', width: '100px' },
            { header: 'Lượt khám', align: 'right', width: '76px' },
            { header: 'Lượt có thuốc', align: 'right', width: '100px' },
            { header: 'Dòng thuốc', align: 'right', width: '84px' },
            { header: 'Dòng / đơn', align: 'right', width: '84px' },
            { header: 'Lượt có CLS', align: 'right', width: '90px' },
            { header: 'CLS tại PK', align: 'right', width: '84px' },
            { header: 'CLS ra ngoài', align: 'right', width: '92px' },
            { header: 'Có hẹn tái khám', align: 'right', width: '110px' },
          ]}
          rows={report.rows.map((r) => [
            <span key="n" className="font-semibold text-slate-900">{r.doctorName}</span>,
            <span key="d" className="text-slate-700">{r.departmentName || '—'}</span>,
            <span key="v" className="font-semibold">{formatCount(r.visits)}</span>,
            formatCount(r.withPrescription),
            formatCount(r.prescriptionItems),
            formatDecimal(r.itemsPerPrescription),
            formatCount(r.withCls),
            formatCount(r.clsInHouse),
            formatCount(r.clsExternal),
            formatCount(r.withFollowUp),
          ])}
          footer={['Cộng', '', formatCount(t.visits), formatCount(t.withPrescription), formatCount(t.prescriptionItems), formatDecimal(t.itemsPerPrescription), formatCount(t.withCls), formatCount(t.clsInHouse), formatCount(t.clsExternal), formatCount(t.withFollowUp)]}
          maxBodyHeightClass="max-h-[480px]"
        />
      </ReportCard>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <TopList title="Thuốc kê nhiều nhất" hint="10 thuốc đầu theo số dòng kê" unit="Thuốc" items={report.topDrugs} emptyText="Chưa có đơn thuốc nào trong kỳ." />
        <TopList title="Chỉ định cận lâm sàng nhiều nhất" hint="10 chỉ định đầu, không tính dòng đã huỷ" unit="Chỉ định" items={report.topOrders} emptyText="Chưa có chỉ định cận lâm sàng nào trong kỳ." />
      </div>
    </>
  );
}

/** Tab "Cơ cấu kê đơn và chỉ định": lượt có thuốc, dòng thuốc, chỉ định cận lâm sàng tại phòng khám/ra ngoài, hẹn tái khám của từng bác sĩ, cùng thuốc và chỉ định nhiều nhất. */
export function DoctorOrderMixTab({ period, scope, filter }: { period: ReportPeriodState; scope: ReportScopeState; filter: DoctorFilterState }) {
  const extraParams = useMemo(() => ({ departmentId: filter.departmentId || undefined }), [filter.departmentId]);
  return (
    <PeriodReportTab<DoctorOrderMixReport, DoctorPeriodParams>
      period={period}
      scope={scope}
      kinds={DOCTOR_PERIOD_KINDS}
      controls={filter.control}
      extraParams={extraParams}
      exportFile={(p) => exportDoctorExcel('order-mix', p)}
      useReport={useDoctorOrderMixQuery}
      buildPrint={(report, ctx) => buildDoctorOrderMixPrintSpec(report, { ...ctx, departmentLabel: filter.departmentLabel })}
      errorMessage="Không tải được báo cáo cơ cấu kê đơn và chỉ định."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
