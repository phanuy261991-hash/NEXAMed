import { formatAxisTick, niceAxis } from '../revenue/revenue-model';
import { axisLabelIndexes, branchLineStyle, formatDayMonthLabel } from './system-model';

export interface BranchLineSeries {
  branchId: string;
  branchName: string;
  values: readonly number[];
}

const WIDTH = 1100;
const HEIGHT = 240;
const LEFT = 50;
const RIGHT = 14;
const TOP = 20;
const BASE = 200;

/**
 * Biểu đồ đường Thực thu theo ngày của từng chi nhánh (mockup đã duyệt 05/11/2026). Vẽ SVG thuần, co giãn theo chiều rộng khung. Mỗi chi nhánh một MÀU và một KIỂU NÉT (liền, gạch, chấm...)
 * nên phân biệt được cả khi không thấy màu; chú giải ở trên khung. Ngày hoàn tiền nhiều hơn thu (âm) vẽ ở đáy trục. Mỗi điểm có `<title>` để rê chuột xem số đồng đầy đủ.
 */
export function BranchLineChart({ dates, series, ariaLabel }: { dates: readonly string[]; series: readonly BranchLineSeries[]; ariaLabel: string }) {
  const axis = niceAxis(Math.max(0, ...series.flatMap((s) => s.values)));
  const plotWidth = WIDTH - LEFT - RIGHT;
  const x = (i: number) => (dates.length <= 1 ? LEFT + plotWidth / 2 : LEFT + (plotWidth * i) / (dates.length - 1));
  const y = (value: number) => BASE - (Math.max(value, 0) / axis.max) * (BASE - TOP);
  const labelAt = axisLabelIndexes(dates.length, 6);

  return (
    <div className="px-4 pb-2 pt-3">
      <div className="mb-1 flex flex-wrap gap-5 text-[13px] text-slate-700">
        {series.map((s, index) => {
          const style = branchLineStyle(index);
          return (
            <span key={s.branchId} className="inline-flex items-center gap-1.5">
              <svg width="26" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="26" y2="4" stroke={style.color} strokeWidth="2.4" strokeDasharray={style.dash} />
              </svg>
              {s.branchName}
            </span>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={ariaLabel}>
        <g stroke="#e2e8f0">
          {axis.ticks.map((tick) => (
            <line key={tick} x1={LEFT} y1={y(tick)} x2={WIDTH - RIGHT} y2={y(tick)} />
          ))}
        </g>
        <g fontSize="11" fill="#475569" textAnchor="end">
          {axis.ticks.map((tick) => (
            <text key={tick} x={LEFT - 6} y={y(tick) + 4}>
              {formatAxisTick(tick, axis.unit)}
            </text>
          ))}
        </g>
        <g fontSize="11.5" fill="#475569" textAnchor="middle">
          {labelAt.map((i) => (
            <text key={i} x={x(i)} y={222}>
              {formatDayMonthLabel(dates[i]!)}
            </text>
          ))}
        </g>
        {series.map((s, index) => {
          const style = branchLineStyle(index);
          return (
            <g key={s.branchId}>
              <polyline fill="none" stroke={style.color} strokeWidth="2.2" strokeLinejoin="round" strokeDasharray={style.dash} points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
              {dates.length <= 40 &&
                s.values.map((v, i) => (
                  <circle key={dates[i]} cx={x(i)} cy={y(v)} r="2.4" fill={style.color}>
                    <title>{`${s.branchName}, ${formatDayMonthLabel(dates[i]!)}: ${v.toLocaleString('vi-VN')} đ`}</title>
                  </circle>
                ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
