import { formatAxisTick, niceAxis } from './revenue-model';

export interface RevenueBarDatum {
  label: string;
  recognized: number;
  net: number;
}

const WIDTH = 1100;
const HEIGHT = 240;
const LEFT = 50;
const RIGHT = 10;
const TOP = 30;
const BASE = 200;

/**
 * Biểu đồ cột đôi Ghi nhận (xám) và Thực thu (xanh lục) theo từng khoảng của báo cáo Doanh thu theo kỳ (mockup đã duyệt 05/11/2026). Vẽ SVG thuần, co giãn theo chiều rộng khung;
 * số khoảng nhiều (gom theo ngày) thì cột mảnh lại và chỉ ghi nhãn một số khoảng để không chồng chữ. Mỗi cột có `<title>` để rê chuột xem số đồng đầy đủ.
 */
export function RevenueBarChart({ data, ariaLabel }: { data: readonly RevenueBarDatum[]; ariaLabel: string }) {
  const axis = niceAxis(Math.max(0, ...data.flatMap((d) => [d.recognized, d.net])));
  const plotWidth = WIDTH - LEFT - RIGHT;
  const slot = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.max(2, Math.min(34, (slot - 8) / 2));
  const y = (value: number) => BASE - (Math.max(value, 0) / axis.max) * (BASE - TOP);
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));

  return (
    <div className="px-4 pb-2 pt-3">
      <div className="mb-1 flex flex-wrap gap-5 text-[13px] text-slate-700">
        <span>
          <span className="mr-1.5 inline-block h-3 w-3 bg-slate-400 align-middle" aria-hidden="true" />
          Ghi nhận (theo ngày khám)
        </span>
        <span>
          <span className="mr-1.5 inline-block h-3 w-3 bg-emerald-700 align-middle" aria-hidden="true" />
          Thực thu (theo ngày thu)
        </span>
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
        {data.map((d, i) => {
          const center = LEFT + slot * i + slot / 2;
          return (
            <g key={`${d.label}-${i}`}>
              <title>{`${d.label}: ghi nhận ${d.recognized.toLocaleString('vi-VN')} đ, thực thu ${d.net.toLocaleString('vi-VN')} đ`}</title>
              <rect x={center - barWidth - 1} y={y(d.recognized)} width={barWidth} height={BASE - y(d.recognized)} fill="#94a3b8" />
              <rect x={center + 1} y={y(d.net)} width={barWidth} height={BASE - y(d.net)} fill="#047857" />
              {i % labelEvery === 0 && (
                <text x={center} y={222} fontSize="11.5" fill="#475569" textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
