export type TrendPointTone = 'normal' | 'high' | 'low';

export interface TrendPoint {
  /** Định danh điểm — trả lại qua `onSelect` khi bấm điểm. */
  id: string;
  /** Hai dòng nhãn dưới trục ngang (ví dụ "12/01" và "2026"). */
  label: string;
  subLabel?: string;
  value: number;
  /** Chữ hiện trên điểm (đã định dạng đúng số lẻ). */
  valueLabel: string;
  tone: TrendPointTone;
  /** Chữ hiện khi rê chuột (tooltip trình duyệt) và đọc bởi screen reader. */
  description: string;
}

const WIDTH = 760;
const HEIGHT = 270;
const MARGIN = { left: 56, right: 24, top: 18, bottom: 44 };
const MAX_VALUE_LABELS = 14;
const MAX_X_LABELS = 12;

const TONE_FILL: Record<TrendPointTone, string> = { normal: 'fill-brand-teal', high: 'fill-rose-600', low: 'fill-amber-500' };
const TONE_TEXT: Record<TrendPointTone, string> = { normal: 'fill-slate-800', high: 'fill-rose-600', low: 'fill-amber-600' };

/**
 * Biểu đồ đường theo thời gian cho MỘT đại lượng (ví dụ diễn biến một chỉ số xét nghiệm) — vẽ tay bằng SVG, KHÔNG thêm thư viện chart (đúng
 * `.claude/docs/coding-standards.md` mục "Hiệu năng"). Dải xanh là khoảng tham chiếu (`low`/`high`, một đầu có thể trống); điểm tô màu theo cao/thấp/bình thường.
 * Nhận dữ liệu qua props, không biết gì về xét nghiệm — dùng lại được cho sinh hiệu, cân nặng… Điểm bấm được khi truyền `onSelect` (có cả bàn phím Enter/Space).
 */
export function TrendChart({
  points,
  low,
  high,
  onSelect,
  ariaLabel,
}: {
  points: readonly TrendPoint[];
  low: number | null;
  high: number | null;
  onSelect?: (id: string) => void;
  ariaLabel: string;
}) {
  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  let min = Math.min(...values, ...(low === null ? [] : [low]));
  let max = Math.max(...values, ...(high === null ? [] : [high]));
  const pad = (max - min) * 0.18 || Math.abs(max) * 0.1 || 1;
  min -= pad;
  max += pad;
  if (low === null && min < 0 && Math.min(...values) >= 0) min = 0;

  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (index: number) => MARGIN.left + (points.length === 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1));
  const y = (value: number) => MARGIN.top + plotHeight * (1 - (value - min) / (max - min));
  const decimalsOf = Math.abs(max - min) < 10 ? 1 : 0;

  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const bandTop = high === null ? MARGIN.top : Math.max(MARGIN.top, y(high));
  const bandBottom = low === null ? HEIGHT - MARGIN.bottom : Math.min(HEIGHT - MARGIN.bottom, y(low));
  const valueStep = Math.max(1, Math.ceil(points.length / MAX_VALUE_LABELS));
  const xStep = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel} className="block h-auto w-full">
      {ticks.map((tick, i) => (
        <g key={i}>
          <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} className="stroke-slate-200" strokeWidth={1} />
          <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} className="fill-slate-500">
            {tick.toFixed(decimalsOf).replace('.', ',')}
          </text>
        </g>
      ))}
      <rect x={MARGIN.left} y={bandTop} width={plotWidth} height={Math.max(0, bandBottom - bandTop)} className="fill-emerald-500/15" />
      {high !== null && <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(high)} y2={y(high)} className="stroke-emerald-500" strokeWidth={1} strokeDasharray="4 3" />}
      {low !== null && <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(low)} y2={y(low)} className="stroke-emerald-500" strokeWidth={1} strokeDasharray="4 3" />}
      <polyline fill="none" className="stroke-slate-400" strokeWidth={1.75} points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
      {points.map((p, i) => (
        <g key={p.id}>
          <circle
            cx={x(i)}
            cy={y(p.value)}
            r={5.5}
            strokeWidth={2}
            className={`stroke-white ${TONE_FILL[p.tone]} ${onSelect ? 'cursor-pointer' : ''}`}
            {...(onSelect
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': p.description,
                  onClick: () => onSelect(p.id),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(p.id);
                    }
                  },
                }
              : {})}
          >
            <title>{p.description}</title>
          </circle>
          {(i % valueStep === 0 || i === points.length - 1) && (
            <text x={x(i)} y={y(p.value) - 11} textAnchor="middle" fontSize={12} fontWeight={600} className={TONE_TEXT[p.tone]}>
              {p.valueLabel}
            </text>
          )}
          {(i % xStep === 0 || i === points.length - 1) && (
            <>
              <text x={x(i)} y={HEIGHT - MARGIN.bottom + 18} textAnchor="middle" fontSize={11} className="fill-slate-500">
                {p.label}
              </text>
              {p.subLabel && (
                <text x={x(i)} y={HEIGHT - MARGIN.bottom + 31} textAnchor="middle" fontSize={10} className="fill-slate-500">
                  {p.subLabel}
                </text>
              )}
            </>
          )}
        </g>
      ))}
    </svg>
  );
}
