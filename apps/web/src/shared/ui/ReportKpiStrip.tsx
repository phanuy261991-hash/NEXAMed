/**
 * Dải số liệu tổng quan đầu trang báo cáo (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): MỘT khung trắng, các ô chia bằng đường kẻ mảnh, nhãn nhỏ xám phía trên, con số lớn có màu
 * theo ý nghĩa, dòng phụ xám phía dưới. Khác `StatCardRow` (có biểu tượng, dùng ở các trang Sổ quỹ) — báo cáo điều hành không dùng biểu tượng. Nhận dữ liệu qua props để mọi báo cáo dùng chung.
 */
export type ReportKpiTone = 'default' | 'blue' | 'green' | 'teal' | 'amber' | 'rose' | 'slate';

const TONE_CLASS: Record<ReportKpiTone, string> = {
  default: 'text-slate-900',
  blue: 'text-blue-700',
  green: 'text-emerald-700',
  teal: 'text-teal-700',
  amber: 'text-amber-700',
  rose: 'text-rose-700',
  slate: 'text-slate-700',
};

/** Màu dòng phụ: `good` xanh lục (tăng so với kỳ trước), `bad` đỏ (giảm), mặc định xám. */
export type ReportKpiSubTone = 'good' | 'bad';

const SUB_TONE_CLASS: Record<ReportKpiSubTone, string> = { good: 'text-emerald-700', bad: 'text-rose-700' };

export interface ReportKpiItem {
  label: string;
  value: string;
  /** Dòng phụ dưới con số (ví dụ "182 trên 1.284 lượt"). */
  sub?: string;
  tone?: ReportKpiTone;
  /** Màu của dòng phụ (ví dụ "▲ 8,4% so với kỳ trước"); bỏ trống = xám. */
  subTone?: ReportKpiSubTone;
}

export function ReportKpiStrip({ items, ariaLabel }: { items: readonly ReportKpiItem[]; ariaLabel: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap rounded-lg border border-slate-200 bg-white shadow-sm">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-[200px] flex-1 basis-[200px] flex-col gap-1 border-r border-slate-100 px-5 py-4 last:border-r-0">
          <div className="text-[15px] font-semibold text-slate-800">{item.label}</div>
          <div className={`text-2xl font-semibold tabular-nums ${TONE_CLASS[item.tone ?? 'default']}`}>{item.value}</div>
          {item.sub && <div className={`text-[12.5px] ${item.subTone ? SUB_TONE_CLASS[item.subTone] : 'text-slate-600'}`}>{item.sub}</div>}
        </div>
      ))}
    </div>
  );
}
