import { niceScale } from './chart-scale';

export interface ColumnItem {
  label: string;
  value: number;
  /** Chữ in trên đỉnh cột (đã định dạng). */
  valueLabel: string;
}

const WIDTH = 620;
const HEIGHT = 192;
const MARGIN = { left: 34, right: 8, top: 16, bottom: 42 };

/**
 * Biểu đồ cột cho một chuỗi theo ngày (ví dụ thực thu 7 ngày): cột cuối (hôm nay) tô đặc, các cột trước tô nhạt; nhãn giá trị trên đỉnh, nhãn ngày dưới trục, `unitLabel` ở góc dưới trái.
 * Vẽ tay bằng SVG — không thêm thư viện biểu đồ. Nhận dữ liệu qua props.
 */
export function ColumnChart({
  items,
  unitLabel,
  ariaLabel,
  tickLabel = (v) => String(v),
  color = '#2563eb',
}: {
  items: readonly ColumnItem[];
  unitLabel: string;
  ariaLabel: string;
  /** Nhãn vạch trục tung (ví dụ chia triệu). */
  tickLabel?: (value: number) => string;
  color?: string;
}) {
  if (items.length === 0) return null;
  const maxValue = Math.max(...items.map((i) => i.value));
  const scale = niceScale(maxValue, 2, 1.03);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = plotWidth / items.length;
  const barWidth = Math.min(52, slot * 0.64);
  const baseY = MARGIN.top + plotHeight;
  const y = (v: number) => MARGIN.top + plotHeight * (1 - v / scale.max);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={ariaLabel} className="block">
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line x1={MARGIN.left} y1={y(tick)} x2={WIDTH - MARGIN.right} y2={y(tick)} stroke={tick === 0 ? '#e2e8f0' : '#f1f5f9'} strokeWidth={1} />
          <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={12} fill="#94a3b8">
            {tickLabel(tick)}
          </text>
        </g>
      ))}
      {items.map((item, i) => {
        const cx = MARGIN.left + slot * i + slot / 2;
        const top = y(item.value);
        const isLast = i === items.length - 1;
        const height = Math.max(0, baseY - top);
        const r = Math.min(6, height / 2);
        return (
          <g key={i}>
            {height > 0 && (
              <path
                d={`M${cx - barWidth / 2},${baseY} L${cx - barWidth / 2},${top + r} Q${cx - barWidth / 2},${top} ${cx - barWidth / 2 + r},${top} L${cx + barWidth / 2 - r},${top} Q${cx + barWidth / 2},${top} ${cx + barWidth / 2},${top + r} L${cx + barWidth / 2},${baseY} Z`}
                fill={color}
                opacity={isLast ? 1 : 0.32}
              />
            )}
            <text x={cx} y={Math.max(11, top - 7)} textAnchor="middle" fontSize={isLast ? 13 : 12} fontWeight={isLast ? 600 : 400} fill={isLast ? '#1d4ed8' : '#64748b'}>
              {item.valueLabel}
            </text>
            <text x={cx} y={baseY + 18} textAnchor="middle" fontSize={12} fontWeight={isLast ? 600 : 400} fill={isLast ? '#1e293b' : '#64748b'}>
              {item.label}
            </text>
          </g>
        );
      })}
      <text x={MARGIN.left} y={HEIGHT - 4} fontSize={12} fill="#94a3b8">
        {unitLabel}
      </text>
    </svg>
  );
}
