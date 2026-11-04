export interface BarStripItem {
  /** Nhãn dưới cột (ví dụ giờ "10"). */
  label: string;
  value: number;
  /** Chữ trên đỉnh cột đông nhất (đã định dạng). */
  valueLabel: string;
}

const BAR_AREA_PX = 140;

/**
 * Dải cột gọn cho chuỗi dài như tiền thu theo giờ (trang Tổng quan, hướng B): cột bo tròn không trục kẻ, cột `peakIndex` tô đặc và in giá trị, các cột còn lại tô nhạt;
 * nhãn dưới cột. Cao theo tỉ lệ với giá trị lớn nhất. Dựng bằng HTML (không SVG) để chữ theo cỡ chữ của trang. Nhận dữ liệu qua props.
 */
export function BarStrip({ items, peakIndex, ariaLabel }: { items: readonly BarStripItem[]; peakIndex: number | null; ariaLabel: string }) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="flex items-end gap-3" style={{ height: BAR_AREA_PX + 22 }}>
        {items.map((item, i) => {
          const isPeak = i === peakIndex;
          const height = item.value > 0 ? Math.max(6, Math.round((item.value / max) * BAR_AREA_PX)) : 3;
          return (
            <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              {isPeak && <span className="text-xs font-semibold text-emerald-700">{item.valueLabel}</span>}
              <div className={`w-full rounded-lg ${isPeak ? 'bg-emerald-500' : item.value > 0 ? 'bg-emerald-100' : 'bg-slate-100'}`} style={{ height }} />
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex gap-3 text-xs text-slate-400">
        {items.map((item, i) => (
          <span key={i} className={`min-w-0 flex-1 text-center ${i === peakIndex ? 'font-semibold text-slate-900' : ''}`}>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
