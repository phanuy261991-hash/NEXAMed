import { useMemo, useState } from 'react';
import { ChartLineUp, Eye, MagnifyingGlass } from '@phosphor-icons/react';
import type { ParaclinicalValueFlag, PatientIndicatorPoint, PatientIndicatorSummary } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { stripDiacritics } from '../../shared/format/strip-diacritics';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { TrendChart, type TrendPoint, type TrendPointTone } from '../../shared/ui/TrendChart';
import { formatDateStringVi, toVietnamDateString } from '../encounter/follow-up-date';
import { usePatientIndicatorTrendQuery } from '../paraclinical-result/patient-paraclinical.queries';

/** Khoá một chỉ số theo dõi: mã + đơn vị (đổi đơn vị giữa các lần đo là hai mục riêng, không quy đổi). */
const keyOf = (i: { code: string; unit: string | null }) => `${i.code}\u0000${i.unit ?? ''}`;

const toneOf = (flag: ParaclinicalValueFlag | null): TrendPointTone => (flag === 'HIGH' ? 'high' : flag === 'LOW' ? 'low' : 'normal');
const comma = (text: string) => text.replace('.', ',');

/**
 * "Diễn biến chỉ số" của tab Kết quả cận lâm sàng (docs/DECISIONS.md #234, mockup đã duyệt): bên trái danh sách chỉ số dạng số của bệnh nhân (gom theo nhóm dịch vụ, tìm được), bên phải biểu
 * đồ đường qua các lần đo kèm dải khoảng tham chiếu và bảng giá trị từng lần. Bấm một điểm hoặc nút Xem mở đúng kết quả lần đo đó. Dải tham chiếu trên biểu đồ lấy theo lần đo gần
 * nhất; bảng ghi khoảng tham chiếu đúng của từng lần (khoảng đổi theo tuổi/giới).
 */
export function PatientIndicatorTrend({
  patientId,
  indicators,
  onOpenResult,
}: {
  patientId: string;
  indicators: PatientIndicatorSummary[];
  /** Mở kết quả (hộp thoại Xem) của lần đo có id dòng chỉ định này. */
  onOpenResult: (itemId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [chosenKey, setChosenKey] = useState<string | null>(null);

  // Mặc định chọn chỉ số có NHIỀU lần đo nhất (biểu đồ có ý nghĩa nhất); chỉ số đã chọn mà biến mất khỏi danh sách (đổi dữ liệu) thì rơi về mặc định.
  const defaultKey = useMemo(() => {
    const best = indicators.reduce<PatientIndicatorSummary | null>((acc, i) => (acc === null || i.measureCount > acc.measureCount ? i : acc), null);
    return best ? keyOf(best) : null;
  }, [indicators]);
  const selectedKey = chosenKey !== null && indicators.some((i) => keyOf(i) === chosenKey) ? chosenKey : defaultKey;
  const selected = indicators.find((i) => keyOf(i) === selectedKey) ?? null;

  const grouped = useMemo(() => {
    const needle = stripDiacritics(search.trim());
    const map = new Map<string, PatientIndicatorSummary[]>();
    for (const i of indicators) {
      if (needle && !stripDiacritics(`${i.name} ${i.code}`).includes(needle)) continue;
      const group = i.groupName ?? 'Khác';
      map.set(group, [...(map.get(group) ?? []), i]);
    }
    return [...map.entries()];
  }, [indicators, search]);

  const trend = usePatientIndicatorTrendQuery(patientId, selected ? { code: selected.code, unit: selected.unit ?? undefined } : null);

  if (indicators.length === 0) {
    return (
      <EmptyState
        icon={ChartLineUp}
        title="Chưa có chỉ số nào để theo dõi diễn biến"
        description="Chỉ số xét nghiệm dạng số (đường huyết, creatinin…) hiện ở đây sau khi bệnh nhân có kết quả đã duyệt."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-2.5">
          <div className="relative">
            <MagnifyingGlass size={15} weight="regular" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm chỉ số…"
              aria-label="Tìm chỉ số"
              className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-[13px] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
        <div className="scroll-hover max-h-[460px] overflow-y-auto">
          {grouped.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">Không có chỉ số nào khớp.</p>}
          {grouped.map(([groupName, list]) => (
            <div key={groupName}>
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{groupName}</div>
              {list.map((i) => {
                const active = keyOf(i) === selectedKey;
                return (
                  <button
                    key={keyOf(i)}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setChosenKey(keyOf(i))}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-b border-l-[3px] border-b-slate-100 px-3 py-2 text-left ${
                      active ? 'border-l-brand-teal bg-blue-50' : 'border-l-transparent hover:bg-slate-50'
                    }`}
                  >
                    <span className="break-words text-[13.5px] font-semibold text-slate-900">{i.name}</span>
                    <span className={`text-right text-[13.5px] font-semibold tabular-nums ${i.latestFlag === 'HIGH' ? 'text-rose-600' : i.latestFlag === 'LOW' ? 'text-amber-600' : 'text-slate-900'}`}>
                      {comma(i.latestValueText)} {i.unit && <span className="text-[11.5px] font-medium text-slate-500">{i.unit}</span>}
                    </span>
                    <span className="col-span-2 text-xs font-medium text-slate-500">
                      {i.measureCount} lần đo · gần nhất {formatDateStringVi(toVietnamDateString(i.latestSignedAt))}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {trend.isPending && selected && (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-60 w-full" />
          </div>
        )}
        {trend.isError && (
          <div className="p-4">
            <ErrorBanner message={trend.error instanceof ApiError ? trend.error.message : 'Không tải được diễn biến chỉ số.'} onRetry={() => void trend.refetch()} />
          </div>
        )}
        {trend.data && <TrendPanel name={trend.data.name} unit={trend.data.unit} points={trend.data.points} multiBranch={trend.data.multiBranch} onOpenResult={onOpenResult} />}
      </div>
    </div>
  );
}

function TrendPanel({ name, unit, points, multiBranch, onOpenResult }: { name: string; unit: string | null; points: PatientIndicatorPoint[]; multiBranch: boolean; onOpenResult: (itemId: string) => void }) {
  const latest = points[points.length - 1];
  const chartPoints: TrendPoint[] = points.map((p) => {
    const date = formatDateStringVi(toVietnamDateString(p.signedAt));
    return {
      id: p.itemId,
      label: date.slice(0, 5),
      subLabel: date.slice(6),
      value: p.value,
      valueLabel: comma(p.valueText),
      tone: toneOf(p.flag),
      description: `${date}: ${comma(p.valueText)}${unit ? ` ${unit}` : ''}${p.flag === 'HIGH' ? ' (cao)' : p.flag === 'LOW' ? ' (thấp)' : ''}`,
    };
  });

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-3">
        <h3 className="text-[15px] font-semibold text-slate-900">
          {name} {unit && <span className="font-medium text-slate-500">({unit})</span>}
        </h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2 w-3 rounded-sm border border-emerald-500 bg-emerald-500/20" />
            Khoảng tham chiếu {latest && latest.referenceText ? latest.referenceText : '(chưa khai)'}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2 w-3 rounded-sm bg-brand-teal" />
            Trong khoảng
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2 w-3 rounded-sm bg-rose-600" />
            Cao
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2 w-3 rounded-sm bg-amber-500" />
            Thấp
          </span>
        </div>
      </div>
      <div className="px-2 pt-2">
        <TrendChart points={chartPoints} low={latest?.low ?? null} high={latest?.high ?? null} onSelect={onOpenResult} ariaLabel={`Biểu đồ diễn biến ${name} qua ${points.length} lần đo`} />
      </div>
      <div className="scroll-hover max-h-[260px] overflow-auto border-t border-slate-200">
        <table className="w-full text-sm" style={{ minWidth: 560, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 120 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
              <th className="px-3 py-2.5 text-center">Ngày</th>
              <th className="px-3 py-2.5 text-center">Giá trị</th>
              <th className="px-3 py-2.5 text-center">Khoảng tham chiếu</th>
              <th className="px-3 py-2.5 text-center">Đánh giá</th>
              <th className="px-3 py-2.5 text-center">Mã phiếu</th>
              <th className="px-3 py-2.5 text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.itemId} className={`border-b border-slate-100 hover:bg-slate-50 ${multiBranch && p.isOtherBranch ? 'bg-blue-50' : ''}`}>
                <td className="px-3 py-2 text-center font-semibold tabular-nums text-brand-teal">{formatDateStringVi(toVietnamDateString(p.signedAt))}</td>
                <td className={`px-3 py-2 text-center font-semibold tabular-nums ${p.flag === 'HIGH' ? 'text-rose-600' : p.flag === 'LOW' ? 'text-amber-600' : 'text-slate-900'}`}>
                  {comma(p.valueText)} {unit && <span className="font-medium text-slate-500">{unit}</span>}
                </td>
                <td className="px-3 py-2 text-center font-medium tabular-nums text-slate-700">{p.referenceText || <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2 text-center">
                  {p.flag === 'HIGH' ? <StatusBadge tone="danger">Cao ↑</StatusBadge> : p.flag === 'LOW' ? <StatusBadge tone="warning">Thấp ↓</StatusBadge> : p.flag === 'NORMAL' ? <StatusBadge tone="success">Bình thường</StatusBadge> : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-3 py-2 text-center font-semibold tabular-nums text-slate-800">{p.orderNo}</td>
                <td className="px-3 py-2 text-center">
                  <RowActionButton icon={Eye} label="Xem kết quả" tone="primary" onClick={() => onOpenResult(p.itemId)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
