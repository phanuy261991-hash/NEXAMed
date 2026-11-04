const WIDTH = 104;
const HEIGHT = 26;
const PAD_X = 4;
const PAD_TOP = 4;

/**
 * Đường nhỏ diễn biến vài ngày (dưới con số của ô KPI): vùng tô nhạt + nét + chấm ở điểm cuối. Vẽ tay bằng SVG, không thêm thư viện biểu đồ. Mọi giá trị bằng nhau (kể cả toàn 0)
 * thì vẽ đường phẳng giữa khung, không chia cho 0. Cần ít nhất 2 điểm mới vẽ.
 */
export function Sparkline({ values, color, ariaLabel }: { values: readonly number[]; color: string; ariaLabel: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const plotHeight = HEIGHT - PAD_TOP - 2;
  const x = (i: number) => PAD_X + ((WIDTH - 2 * PAD_X) * i) / (values.length - 1);
  const y = (v: number) => (span === 0 ? PAD_TOP + plotHeight / 2 : PAD_TOP + plotHeight * (1 - (v - min) / span));
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lastX = x(values.length - 1);
  const area = `${line} L${lastX.toFixed(1)},${HEIGHT} L${PAD_X},${HEIGHT} Z`;
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={y(values[values.length - 1]!)} r={2.6} fill={color} />
    </svg>
  );
}
