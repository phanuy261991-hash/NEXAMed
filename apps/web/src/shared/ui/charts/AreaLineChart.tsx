import { niceScale } from './chart-scale';

export interface AreaLinePoint {
  /** Nhãn trục ngang của điểm này, hoặc `null` nếu không in nhãn (thưa bớt cho khỏi chen). */
  xLabel: string | null;
  value: number;
}

const WIDTH = 640;
const HEIGHT = 212;
const MARGIN = { left: 44, right: 10, top: 16, bottom: 32 };

/**
 * Biểu đồ đường có vùng tô nhạt cho MỘT chuỗi (ví dụ lượt khám theo giờ): lưới ngang mảnh, điểm cao nhất có chấm + chú thích tối ("10:00 – 11:00 / 12 lượt khám").
 * Vẽ tay bằng SVG — không thêm thư viện biểu đồ. Nhận dữ liệu và chú thích qua props, không biết gì về lượt khám. `peakLabel` là hai dòng chữ của chú thích; truyền `null` để không hiện.
 */
export function AreaLineChart({
  points,
  peakIndex,
  peakLabel,
  ariaLabel,
  color = '#2563eb',
}: {
  points: readonly AreaLinePoint[];
  peakIndex: number | null;
  peakLabel: { line1: string; line2: string } | null;
  ariaLabel: string;
  color?: string;
}) {
  if (points.length < 2) return null;
  const maxValue = Math.max(...points.map((p) => p.value));
  const scale = niceScale(maxValue);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (i: number) => MARGIN.left + (plotWidth * i) / (points.length - 1);
  const y = (v: number) => MARGIN.top + plotHeight * (1 - v / scale.max);
  const baseY = MARGIN.top + plotHeight;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${baseY} L${MARGIN.left},${baseY} Z`;

  const peak = peakIndex !== null && peakLabel ? { i: peakIndex, px: x(peakIndex), py: y(points[peakIndex]!.value) } : null;
  // Chú thích đặt bên phải điểm đỉnh; sát mép phải thì lật sang trái.
  const tipWidth = 116;
  const tipX = peak ? (peak.px + 14 + tipWidth > WIDTH - 4 ? peak.px - 14 - tipWidth : peak.px + 14) : 0;
  const tipY = peak ? Math.max(MARGIN.top + 2, peak.py - 22) : 0;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={ariaLabel} className="block">
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line x1={MARGIN.left} y1={y(tick)} x2={WIDTH - MARGIN.right} y2={y(tick)} stroke={tick === 0 ? '#e2e8f0' : '#f1f5f9'} strokeWidth={1} />
          <text x={MARGIN.left - 10} y={y(tick) + 4} textAnchor="end" fontSize={12} fill="#94a3b8">
            {tick}
          </text>
        </g>
      ))}
      <path d={area} fill={color} opacity={0.11} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {peak && (
        <>
          <line x1={peak.px} y1={MARGIN.top + 4} x2={peak.px} y2={baseY} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4 4" />
          <circle cx={peak.px} cy={peak.py} r={5.5} fill={color} stroke="#ffffff" strokeWidth={3} />
          <rect x={tipX} y={tipY} width={tipWidth} height={42} rx={8} fill="#1e293b" />
          <text x={tipX + 12} y={tipY + 18} fontSize={12} fill="#cbd5e1">
            {peakLabel!.line1}
          </text>
          <text x={tipX + 12} y={tipY + 34} fontSize={13} fontWeight={600} fill="#ffffff">
            {peakLabel!.line2}
          </text>
        </>
      )}
      {points.map((p, i) =>
        p.xLabel === null ? null : (
          <text key={i} x={x(i)} y={HEIGHT - 12} textAnchor="middle" fontSize={12} fill="#64748b">
            {p.xLabel}
          </text>
        ),
      )}
    </svg>
  );
}
