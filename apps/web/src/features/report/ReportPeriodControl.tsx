import { DateInput } from '../../shared/ui/DateInput';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { periodLabel, type PeriodKind } from './report-period';
import type { ReportPeriodState } from './useReportPeriod';

/**
 * Bộ chọn "Kỳ" DÙNG CHUNG cho báo cáo điều hành (mockup đã duyệt 05/11/2026): các nút kỳ có sẵn; chọn "Tuỳ chọn" thì hiện thêm hai ô ngày. `kinds` là các kỳ báo cáo đó cho phép
 * (ví dụ Giờ cao điểm chỉ có Tháng này / Tháng trước / Quý / Tuỳ chọn).
 */
export function ReportPeriodControl({ period, kinds }: { period: ReportPeriodState; kinds: readonly PeriodKind[] }) {
  const items = kinds.map((id) => ({ id, label: periodLabel(id, period.today) }));
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-slate-800">Kỳ</span>
        <SegmentedToggle<PeriodKind> items={items} value={period.kind} onChange={period.setKind} ariaLabel="Kỳ của báo cáo" />
      </div>
      {period.kind === 'custom' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-period-from" className="text-sm font-semibold text-slate-800">
              Từ ngày
            </label>
            <DateInput id="report-period-from" value={period.custom.from} onChange={(from) => period.setCustom({ ...period.custom, from })} dense />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-period-to" className="text-sm font-semibold text-slate-800">
              Đến ngày
            </label>
            <DateInput id="report-period-to" value={period.custom.to} onChange={(to) => period.setCustom({ ...period.custom, to })} dense />
          </div>
        </>
      )}
    </>
  );
}
