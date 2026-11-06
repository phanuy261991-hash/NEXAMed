import { MapPin } from '@phosphor-icons/react';
import type { PatientDemographicsReport, PatientPlaceRow } from '@nexamed/shared';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ReportKpiStrip, type ReportKpiItem } from '../../../shared/ui/ReportKpiStrip';
import type { ReportScopeState } from '../../branch/useReportScope';
import { barWidthPercent, formatCount, formatPercent } from '../operations/operations-model';
import { PeriodReportTab } from '../operations/PeriodReportTab';
import { ReportCard } from '../ReportCard';
import { ReportGridTable } from '../ReportGridTable';
import type { ReportPeriodState } from '../useReportPeriod';
import { exportPatientExcel, type PatientPeriodParams } from './patients.api';
import { PATIENT_PERIOD_KINDS } from './PatientNewReturningTab';
import { usePatientDemographicsQuery } from './patients.queries';
import { buildPatientDemographicsPrintSpec } from './patients-print-builders';
import { shareOf } from './patients-model';

function kpis(report: PatientDemographicsReport): ReportKpiItem[] {
  const g = report.genders;
  return [
    { label: 'Bệnh nhân có khám', value: formatCount(report.patients), sub: 'trong kỳ' },
    { label: 'Nữ', value: formatCount(g.female), tone: 'rose', sub: formatPercent(shareOf(g.female, report.patients)) + ' tổng số' },
    { label: 'Nam', value: formatCount(g.male), tone: 'blue', sub: formatPercent(shareOf(g.male, report.patients)) + ' tổng số' },
    { label: 'Giới khác hoặc chưa ghi', value: formatCount(g.other), sub: formatPercent(shareOf(g.other, report.patients)) + ' tổng số' },
    { label: 'Chưa ghi tỉnh/thành', value: formatCount(report.unknownProvince), tone: report.unknownProvince > 0 ? 'amber' : 'default', sub: 'hồ sơ chưa có địa chỉ' },
  ];
}

function PlaceCard({ title, hint, label, rows, total, showProvince, emptyText }: { title: string; hint: string; label: string; rows: readonly PatientPlaceRow[]; total: number; showProvince: boolean; emptyText: string }) {
  const max = Math.max(0, ...rows.map((r) => r.patients));
  return (
    <ReportCard title={title} hint={hint}>
      <ReportGridTable
        ariaLabel={title}
        columns={[
          { header: label, width: 'minmax(130px, 1.4fr)' },
          ...(showProvince ? [{ header: 'Tỉnh/thành', width: 'minmax(110px, 1fr)' }] : []),
          { header: 'Bệnh nhân', align: 'right' as const, width: '84px' },
          { header: 'Tỉ lệ', align: 'right' as const, width: '60px' },
          { header: '', width: 'minmax(60px, 0.7fr)' },
        ]}
        rows={rows.map((r) => [
          <span key="n" className="font-semibold text-slate-900">{r.name}</span>,
          ...(showProvince ? [<span key="p" className="text-slate-700">{r.provinceName || '—'}</span>] : []),
          formatCount(r.patients),
          formatPercent(shareOf(r.patients, total)),
          <div key="b" className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${barWidthPercent(r.patients, max)}%` }} />
          </div>,
        ])}
        emptyText={emptyText}
      />
    </ReportCard>
  );
}

function Body({ report }: { report: PatientDemographicsReport }) {
  if (report.patients === 0) {
    return <EmptyState icon={MapPin} title="Không có lượt khám nào trong kỳ" description="Chưa có bệnh nhân nào được tiếp nhận trong kỳ đã chọn. Đổi kỳ hoặc phạm vi chi nhánh." />;
  }
  const maxBand = Math.max(0, ...report.ageBands.map((b) => b.total));
  const sum = (key: 'male' | 'female' | 'other') => report.ageBands.reduce((s, b) => s + b[key], 0);
  return (
    <>
      <ReportKpiStrip items={kpis(report)} ariaLabel="Số liệu tuổi, giới và địa bàn" />
      <ReportCard title="Theo khoảng tuổi và giới" hint="Tuổi tính đến ngày cuối kỳ">
        <ReportGridTable
          ariaLabel="Bệnh nhân theo khoảng tuổi và giới"
          minWidth={640}
          columns={[
            { header: 'Khoảng tuổi', width: '140px' },
            { header: 'Nam', align: 'right', width: '70px' },
            { header: 'Nữ', align: 'right', width: '70px' },
            { header: 'Khác', align: 'right', width: '70px' },
            { header: 'Cộng', align: 'right', width: '76px' },
            { header: 'Tỉ lệ', align: 'right', width: '64px' },
            { header: '', width: 'minmax(80px, 1fr)' },
          ]}
          rows={report.ageBands.map((b) => [
            <span key="l" className="font-semibold text-slate-900">{b.label}</span>,
            formatCount(b.male),
            formatCount(b.female),
            formatCount(b.other),
            <span key="t" className="font-semibold">{formatCount(b.total)}</span>,
            formatPercent(shareOf(b.total, report.patients)),
            <div key="b" className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-teal-600" style={{ width: `${barWidthPercent(b.total, maxBand)}%` }} />
            </div>,
          ])}
          footer={['Cộng', formatCount(sum('male')), formatCount(sum('female')), formatCount(sum('other')), formatCount(report.patients - report.unknownAge), '', '']}
        />
        {report.unknownAge > 0 && <p className="border-t border-slate-100 px-4 py-2.5 text-[13px] text-amber-700">{formatCount(report.unknownAge)} bệnh nhân chưa có ngày sinh hợp lệ nên không xếp vào khoảng tuổi nào.</p>}
      </ReportCard>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <PlaceCard title="Theo tỉnh/thành" hint="15 tỉnh/thành đông nhất" label="Tỉnh/thành" rows={report.provinces} total={report.patients} showProvince={false} emptyText="Chưa có hồ sơ nào ghi tỉnh/thành." />
        <PlaceCard title="Phường/xã có nhiều bệnh nhân nhất" hint="20 phường/xã đầu" label="Phường/xã" rows={report.wards} total={report.patients} showProvince emptyText="Chưa có hồ sơ nào ghi phường/xã." />
      </div>
    </>
  );
}

/** Tab "Tuổi, giới và địa bàn": phân bố bệnh nhân có khám theo khoảng tuổi và giới, tỉnh/thành, phường/xã. */
export function PatientDemographicsTab({ period, scope }: { period: ReportPeriodState; scope: ReportScopeState }) {
  return (
    <PeriodReportTab<PatientDemographicsReport, PatientPeriodParams>
      period={period}
      scope={scope}
      kinds={PATIENT_PERIOD_KINDS}
      exportFile={(p) => exportPatientExcel('demographics', p)}
      useReport={usePatientDemographicsQuery}
      buildPrint={buildPatientDemographicsPrintSpec}
      errorMessage="Không tải được báo cáo tuổi, giới và địa bàn."
    >
      {(report) => <Body report={report} />}
    </PeriodReportTab>
  );
}
