import { ClipboardText, Warning as WarningIcon, Heartbeat, CalendarBlank, Scales, Ruler } from '@phosphor-icons/react';
import type { PatientVitalSignHistoryItem } from '@nexamed/shared';
import { classifyBmi } from '../encounter/clinical-display';
import { formatDobDisplay } from '../../shared/format/date';

const SPARKLINE_WIDTH = 64;
const SPARKLINE_HEIGHT = 28;
const SPARKLINE_PADDING = 4;

function computeBmi(weightGram: number | null, heightMm: number | null): number | null {
  if (weightGram === null || heightMm === null || heightMm === 0) return null;
  return weightGram / 1000 / (heightMm / 1000) ** 2;
}

/** Tối đa 3 điểm BMI gần nhất (cũ→mới, trái→phải) — vẽ tay bằng SVG, KHÔNG thêm thư viện chart (đúng .claude/docs/coding-standards.md mục "Hiệu năng"). */
function buildBmiSparkline(vitalSigns: PatientVitalSignHistoryItem[]): { points: { x: number; y: number }[]; values: number[] } | null {
  const withBmi = vitalSigns
    .map((v) => ({ bmi: computeBmi(v.weightGram, v.heightMm) }))
    .filter((v): v is { bmi: number } => v.bmi !== null)
    .slice(0, 3)
    .reverse();
  if (withBmi.length < 2) return null;

  const values = withBmi.map((v) => v.bmi);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const usableWidth = SPARKLINE_WIDTH - SPARKLINE_PADDING * 2;
  const usableHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2;
  const points = values.map((v, i) => ({
    x: SPARKLINE_PADDING + (values.length === 1 ? 0 : (i / (values.length - 1)) * usableWidth),
    y: SPARKLINE_PADDING + usableHeight - ((v - min) / range) * usableHeight,
  }));
  return { points, values };
}

function BmiSparkline({ vitalSigns }: { vitalSigns: PatientVitalSignHistoryItem[] }) {
  const spark = buildBmiSparkline(vitalSigns);
  if (!spark) return null;

  const { points, values } = spark;
  const linePath = points.map((p) => `${p.x},${p.y}`).join(' L');
  const baseline = SPARKLINE_HEIGHT - SPARKLINE_PADDING;
  const areaPath = `M${points[0]!.x},${baseline} L${linePath} L${points[points.length - 1]!.x},${baseline} Z`;
  const trend = values[values.length - 1]! - values[0]!;
  const trendLabel = Math.abs(trend) < 0.1 ? 'ổn định' : trend > 0 ? 'đang tăng' : 'đang giảm';

  return (
    <div className="flex items-center gap-2">
      <svg width={60} height={26} viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`} aria-hidden="true">
        <path d={areaPath} fill="#f59e0b" fillOpacity={0.12} />
        <path d={`M${linePath}`} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={i === points.length - 1 ? 3 : 2}
            fill={i === points.length - 1 ? '#d97706' : '#fcd34d'}
            stroke={i === points.length - 1 ? '#fff' : 'none'}
            strokeWidth={i === points.length - 1 ? 1.5 : 0}
          />
        ))}
      </svg>
      <span className="max-w-55 text-xs font-medium text-slate-500">BMI {values.length} lượt gần nhất — {trendLabel}</span>
    </div>
  );
}

/**
 * Dải KPI trang "Hồ sơ bệnh nhân" — 2 dải XẾP CHỒNG (không ép chung 1 hàng — bài học từ nhiều vòng
 * duyệt mockup: ép 4 chỉ số ngang bằng nhau vừa "không nổi bật" vừa dễ vỡ layout ở màn hẹp).
 * Dải 1 "Sinh hiệu gần nhất" nổi bật (BMI + sparkline); dải 2 gồm 3 chỉ số phụ nhỏ hơn có chủ đích.
 */
export function PatientClinicalKpiRow({
  totalCompletedVisits,
  lastCompletedVisitAt,
  vitalSigns,
  allergenCount,
}: {
  totalCompletedVisits: number;
  lastCompletedVisitAt: string | null;
  vitalSigns: PatientVitalSignHistoryItem[];
  allergenCount: number;
}) {
  const latest = vitalSigns[0] ?? null;
  const latestBmi = latest ? computeBmi(latest.weightGram, latest.heightMm) : null;
  const bmiClass = latestBmi !== null ? classifyBmi(latestBmi) : null;
  const bmiTextClass = bmiClass?.tier === 'danger' ? 'text-rose-600' : bmiClass?.tier === 'caution' ? 'text-amber-600' : 'text-emerald-600';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="flex flex-[2_1_320px] flex-wrap items-center justify-between gap-x-7 gap-y-3.5 rounded-[10px] border border-slate-200 bg-amber-50 px-6 py-4 shadow-sm">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-amber-800">
              <Heartbeat size={14} weight="bold" aria-hidden="true" />
              Sinh hiệu gần nhất
            </div>
            {latestBmi !== null && bmiClass ? (
              <div className="flex items-end gap-2.5">
                <div className={`text-[34px] font-bold leading-none tabular-nums ${bmiTextClass}`}>{latestBmi.toFixed(1)}</div>
                <span
                  className={`mb-1 rounded-full px-2 py-1 text-[11px] font-bold text-white ${bmiClass.tier === 'danger' ? 'bg-rose-600' : bmiClass.tier === 'caution' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                >
                  {bmiClass.label}
                </span>
              </div>
            ) : (
              <p className="text-sm font-semibold text-slate-500">Chưa có dữ liệu sinh hiệu</p>
            )}
          </div>
          {vitalSigns.length > 0 && <BmiSparkline vitalSigns={vitalSigns} />}
        </div>

        {latest !== null && (
          <>
            <div className="flex flex-[1_1_140px] flex-col justify-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <Scales size={13} weight="bold" aria-hidden="true" />
                Cân nặng
              </span>
              <span className="text-[21px] font-bold tabular-nums text-slate-900">
                {latest.weightGram !== null ? `${(latest.weightGram / 1000).toFixed(1)} kg` : '—'}
              </span>
            </div>
            <div className="flex flex-[1_1_140px] flex-col justify-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <Ruler size={13} weight="bold" aria-hidden="true" />
                Chiều cao
              </span>
              <span className="text-[21px] font-bold tabular-nums text-slate-900">
                {latest.heightMm !== null ? `${Math.round(latest.heightMm / 10)} cm` : '—'}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap divide-x divide-slate-200 overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-[1_1_180px] flex-col items-center gap-1.5 px-[18px] py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <ClipboardText size={13} weight="bold" aria-hidden="true" />
            Tổng lượt khám
          </span>
          <span className="whitespace-nowrap text-[21px] font-bold tabular-nums text-slate-900">{totalCompletedVisits}</span>
        </div>
        <div className="flex flex-[1_1_180px] flex-col items-center gap-1.5 px-[18px] py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <CalendarBlank size={13} weight="bold" aria-hidden="true" />
            Lần khám gần nhất
          </span>
          <span className="whitespace-nowrap text-[21px] font-bold tabular-nums text-slate-900">
            {lastCompletedVisitAt ? formatDobDisplay(lastCompletedVisitAt.slice(0, 10)) : '—'}
          </span>
        </div>
        <div className="flex flex-[1_1_180px] flex-col items-center gap-1.5 px-[18px] py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <WarningIcon size={13} weight="bold" aria-hidden="true" />
            Dị nguyên đã ghi nhận
          </span>
          <span className={`whitespace-nowrap text-[21px] font-bold tabular-nums ${allergenCount > 0 ? 'text-rose-600' : 'text-slate-900'}`}>{allergenCount}</span>
        </div>
      </div>
    </div>
  );
}
