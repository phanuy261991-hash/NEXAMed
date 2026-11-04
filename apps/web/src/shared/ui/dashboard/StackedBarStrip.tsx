export interface StackedBarItem {
  /** Nhãn dưới cột (ví dụ giờ "10"). */
  label: string;
  /** Các đoạn chồng từ DƯỚI lên; đoạn có `value` 0 không vẽ. */
  segments: ReadonlyArray<{ value: number; className: string }>;
}

const BAR_AREA_PX = 132;
/** Cột trống (tổng 0) vẫn vẽ một vạch mảnh để biết khung giờ có tồn tại. */
const EMPTY_BAR_PX = 4;
const UNIT_MIN = 4;

/**
 * Dải cột CHỒNG cho chuỗi theo giờ (trang Tổng quan, hướng B), ví dụ lịch hẹn "đã đến / chưa đến": mỗi cột là các đoạn bo tròn xếp chồng, chiều cao theo tỉ lệ với cột cao nhất;
 * nhãn dưới cột, cột `emphasizedIndex` (giờ hiện tại) nhãn đậm. Dựng bằng HTML. Nhận dữ liệu qua props.
 */
export function StackedBarStrip({ items, emphasizedIndex, ariaLabel }: { items: readonly StackedBarItem[]; emphasizedIndex?: number | null; ariaLabel: string }) {
  if (items.length === 0) return null;
  const totals = items.map((i) => i.segments.reduce((s, x) => s + x.value, 0));
  const max = Math.max(...totals, 1);
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="flex items-end gap-3" style={{ height: BAR_AREA_PX }}>
        {items.map((item, i) => {
          const total = totals[i]!;
          return (
            <div key={i} className="flex min-w-0 flex-1 flex-col justify-end gap-0.5">
              {total === 0 ? (
                <div className="w-full rounded-lg bg-slate-100" style={{ height: EMPTY_BAR_PX }} />
              ) : (
                // Đoạn đầu mảng nằm DƯỚI cùng → đảo thứ tự khi xếp từ trên xuống.
                [...item.segments].reverse().map((seg, j) =>
                  seg.value > 0 ? <div key={j} className={`w-full rounded-lg ${seg.className}`} style={{ height: Math.max(UNIT_MIN, Math.round((seg.value / max) * (BAR_AREA_PX - 4))) }} /> : null,
                )
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex gap-3 text-xs text-slate-400">
        {items.map((item, i) => (
          <span key={i} className={`min-w-0 flex-1 text-center ${i === emphasizedIndex ? 'font-semibold text-slate-900' : ''}`}>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
