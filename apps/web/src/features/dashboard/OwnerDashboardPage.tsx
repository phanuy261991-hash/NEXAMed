import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowClockwise, Clock, Money, Stethoscope, Trash, UserPlus, WarningCircle, Warehouse } from '@phosphor-icons/react';
import type { DashboardPeriodKind, OwnerDashboard } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { formatClockTime } from '../../shared/format/time';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { AreaLineChart } from '../../shared/ui/charts/AreaLineChart';
import { formatMillions } from '../../shared/ui/charts/chart-scale';
import { ColumnChart } from '../../shared/ui/charts/ColumnChart';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ReportPanel } from '../../shared/ui/ReportPanel';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatCardRow, type StatCardItem } from '../../shared/ui/StatCard';
import { useClinicPrintHeaderQuery } from '../../shared/print/clinic-print-header.queries';
import { useOwnerDashboardQuery } from './dashboard.queries';
import {
  DASHBOARD_PERIOD_ITEMS,
  GROUP_LABEL,
  averageMillions,
  buildAttentionItems,
  compareLabel,
  describeDelta,
  formatDayMonth,
  formatHourRange,
  formatWait,
  formatWeekdayDate,
  periodNoun,
  periodTitle,
  visibleHours,
  type AttentionItem,
} from './dashboard-model';

const SERVICE_COLUMNS = 'minmax(0, 3fr) 76px minmax(0, 1.3fr) 86px';
const QUEUE_COLUMNS = 'minmax(0, 1.6fr) minmax(0, 1.6fr) 90px 76px minmax(0, 1.4fr)';
const HEAD_CLASS = 'grid gap-x-4 border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600';
const ROW_CLASS = 'grid items-center gap-x-4 border-b border-slate-50 px-4 py-2.5';
const TOTAL_ROW_CLASS = 'grid items-center gap-x-4 bg-slate-50 px-4 py-2.5 font-semibold';
const CELL_TEXT = 'min-w-0 truncate';

const ATTENTION_ICON: Record<AttentionItem['kind'], typeof Clock> = { unpaid: WarningCircle, shift: Clock, expiry: Trash, stock: Warehouse };
const ATTENTION_ICON_CLASS: Record<AttentionItem['tone'], string> = { amber: 'text-amber-500', rose: 'text-rose-600' };

function EmptyLine({ children }: { children: string }) {
  return <p className="px-4 py-8 text-center text-sm text-slate-500">{children}</p>;
}

/** Dòng so sánh của ô "Bệnh nhân mới": hiệu số kèm tỉ lệ trên tổng lượt khám. */
function newPatientsDelta(data: OwnerDashboard): StatCardItem['delta'] {
  const delta = describeDelta(data.newPatients, data.period.kind, 'count');
  const share = `chiếm ${data.newPatients.shareOfEncountersPercent}% lượt`;
  if (delta.direction === 'flat') return { direction: 'flat', text: `bằng ${compareLabel(data.period.kind)} · ${share}`, tone: 'neutral' };
  const verb = delta.direction === 'up' ? 'tăng' : 'giảm';
  return { direction: delta.direction, text: `${verb} ${Math.abs(data.newPatients.diff)} · ${share}`, tone: 'neutral' };
}

function KpiRow({ data }: { data: OwnerDashboard }) {
  const kind = data.period.kind;
  const items: StatCardItem[] = [
    {
      icon: Stethoscope,
      tone: 'blue',
      label: 'Lượt khám',
      value: data.encounters.value.toLocaleString('vi-VN'),
      delta: describeDelta(data.encounters, kind, 'count'),
      trend: { values: data.encounters.series, label: `Lượt khám 7 ngày gần nhất, hôm nay ${data.encounters.series.at(-1) ?? 0}` },
    },
    {
      icon: Money,
      tone: 'emerald',
      label: 'Thực thu',
      value: formatVnd(data.collected.value),
      delta: describeDelta(data.collected, kind, 'money'),
      trend: { values: data.collected.series, label: `Thực thu 7 ngày gần nhất, hôm nay ${formatMillions(data.collected.series.at(-1) ?? 0)} triệu` },
    },
    {
      icon: Clock,
      tone: 'amber',
      label: 'Chờ thu',
      value: formatVnd(data.pending.amount),
      delta: { direction: 'flat', text: data.pending.invoiceCount > 0 ? `${data.pending.invoiceCount} phiếu chưa thanh toán` : 'không còn phiếu chờ thu', tone: 'neutral' },
      trend: { values: data.pending.series, label: `Tiền chờ thu theo ngày tiếp nhận, 7 ngày gần nhất` },
    },
    {
      icon: UserPlus,
      tone: 'violet',
      label: 'Bệnh nhân mới',
      value: data.newPatients.value.toLocaleString('vi-VN'),
      delta: newPatientsDelta(data),
      trend: { values: data.newPatients.series, label: `Bệnh nhân khám lần đầu 7 ngày gần nhất, hôm nay ${data.newPatients.series.at(-1) ?? 0}` },
    },
  ];
  return <StatCardRow items={items} />;
}

function HourlyPanel({ data }: { data: OwnerDashboard }) {
  const total = data.hourly.reduce((s, h) => s + h.count, 0);
  const hours = visibleHours(data.hourly);
  const peak = hours.reduce<{ index: number; count: number } | null>((best, h, index) => (h.count > 0 && (best === null || h.count > best.count) ? { index, count: h.count } : best), null);
  const peakHour = peak ? hours[peak.index]!.hour : null;
  return (
    <ReportPanel title="Lượt khám theo giờ" subtitle={peak && peakHour !== null ? `cao điểm ${String(peakHour).padStart(2, '0')}:00 — ${peak.count} lượt` : undefined} className="flex-[999_1_600px]">
      {total === 0 ? (
        <EmptyLine>Chưa có lượt khám nào trong kỳ này.</EmptyLine>
      ) : (
        <div className="px-4 pb-2 pt-4">
          <AreaLineChart
            points={hours.map((h, i) => ({ xLabel: i % 2 === 0 ? String(h.hour).padStart(2, '0') : null, value: h.count }))}
            peakIndex={peak?.index ?? null}
            peakLabel={peak && peakHour !== null ? { line1: formatHourRange(peakHour), line2: `${peak.count} lượt khám` } : null}
            ariaLabel={`Lượt khám theo giờ. Cao điểm ${peakHour ?? 0} giờ với ${peak?.count ?? 0} lượt. Tổng ${total} lượt.`}
          />
        </div>
      )}
    </ReportPanel>
  );
}

function GroupPanel({ data }: { data: OwnerDashboard }) {
  const total = data.collected.value;
  const hasMoney = data.collectedByGroup.some((g) => g.amount !== 0);
  return (
    <ReportPanel
      title="Thực thu theo nhóm"
      className="flex-[1_1_340px]"
      footer={
        <>
          <span className="flex-grow text-slate-800">Tổng thực thu</span>
          <span className="tabular-nums text-blue-600">{formatVnd(total)}</span>
        </>
      }
    >
      {!hasMoney ? (
        <EmptyLine>Chưa có khoản thu trong kỳ này.</EmptyLine>
      ) : (
        <div className="flex flex-col gap-3.5 px-4 py-3.5">
          {data.collectedByGroup.map((g) => (
            <div key={g.group}>
              <div className="mb-1.5 flex items-baseline gap-2 text-[13px]">
                <span className="min-w-0 flex-grow text-slate-700">{GROUP_LABEL[g.group]}</span>
                <span className="font-medium tabular-nums text-emerald-700">{formatVnd(g.amount)}</span>
                <span className="w-9 text-right text-xs tabular-nums text-slate-400">{g.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="presentation">
                <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, g.percent))}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </ReportPanel>
  );
}

function DailyPanel({ data }: { data: OwnerDashboard }) {
  const amounts = data.collectedDaily.map((d) => d.amount);
  const items = data.collectedDaily.map((d, i) => ({
    label: i === data.collectedDaily.length - 1 ? 'Hôm nay' : formatDayMonth(d.date),
    value: d.amount,
    valueLabel: formatMillions(d.amount),
  }));
  return (
    <ReportPanel
      title="Thực thu 7 ngày"
      subtitle={`trung bình ${averageMillions(amounts)} tr/ngày`}
      action={
        <Link to="/cash-book/report" className="text-blue-600 hover:text-blue-700 hover:underline">
          Mở báo cáo dòng tiền
        </Link>
      }
      className="flex-[999_1_560px]"
    >
      <div className="px-4 pb-2 pt-4">
        <ColumnChart
          items={items}
          unitLabel="triệu đồng"
          tickLabel={(v) => (v === 0 ? '0' : Number((v / 1_000_000).toFixed(1)).toLocaleString('vi-VN'))}
          ariaLabel={`Thực thu 7 ngày gần nhất theo triệu đồng: ${data.collectedDaily.map((d) => `${formatDayMonth(d.date)} là ${formatMillions(d.amount)}`).join('; ')}. Trung bình ${averageMillions(amounts)} triệu.`}
        />
      </div>
    </ReportPanel>
  );
}

function AttentionPanel({ data }: { data: OwnerDashboard }) {
  const items = buildAttentionItems(data.needsAttention);
  return (
    <ReportPanel
      title="Cần xử lý"
      badge={items.length > 0 ? <span className="rounded-full bg-rose-600 px-2 text-xs font-semibold tabular-nums text-white">{items.length}</span> : undefined}
      className="flex-[1_1_360px]"
    >
      {items.length === 0 ? (
        <EmptyLine>Không có việc nào cần xử lý.</EmptyLine>
      ) : (
        <ul>
          {items.map((item) => {
            const Icon = ATTENTION_ICON[item.kind];
            return (
              <li key={item.key} className="border-b border-slate-50 last:border-b-0">
                <Link to={item.href} className="flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50">
                  <Icon size={18} weight="fill" className={`flex-none ${ATTENTION_ICON_CLASS[item.tone]}`} aria-hidden="true" />
                  <span className="min-w-0 flex-grow text-[13.5px] text-slate-700">{item.text}</span>
                  <span className={`text-[13px] ${item.kind === 'unpaid' ? 'font-semibold tabular-nums text-amber-600' : 'tabular-nums text-slate-500'}`}>{item.trailing}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ReportPanel>
  );
}

function ServicesPanel({ data }: { data: OwnerDashboard }) {
  const { items, totalCount, totalAmount, shareOfServiceAmountPercent } = data.topServices;
  const top = Math.max(...items.map((i) => i.amount), 1);
  return (
    <ReportPanel title={`Dịch vụ dùng nhiều ${periodNoun(data.period.kind)}`} className="flex-[1_1_100%]">
      {items.length === 0 ? (
        <EmptyLine>Chưa có dịch vụ nào được dùng trong kỳ này.</EmptyLine>
      ) : (
        <div role="table" aria-label="Dịch vụ dùng nhiều" className="text-sm">
          <div role="row" className={HEAD_CLASS} style={{ gridTemplateColumns: SERVICE_COLUMNS }}>
            <span role="columnheader">Dịch vụ</span>
            <span role="columnheader" className="text-right">Số lượt</span>
            <span role="columnheader" className="text-right">Thành tiền</span>
            <span role="columnheader">Tỉ trọng</span>
          </div>
          {items.map((item) => (
            <div role="row" key={item.name} className={ROW_CLASS} style={{ gridTemplateColumns: SERVICE_COLUMNS }}>
              <span role="cell" className={`${CELL_TEXT} font-medium text-slate-800`} title={item.name}>{item.name}</span>
              <span role="cell" className="text-right tabular-nums text-slate-700">{item.count.toLocaleString('vi-VN')}</span>
              <span role="cell" className="text-right font-medium tabular-nums text-emerald-700">{formatVnd(item.amount)}</span>
              <span role="cell">
                <span className="block h-1.5 w-[86px] overflow-hidden rounded-full bg-slate-100" role="presentation">
                  <span className="block h-full rounded-full bg-blue-600" style={{ width: `${Math.round((item.amount / top) * 100)}%` }} />
                </span>
              </span>
            </div>
          ))}
          <div role="row" className={TOTAL_ROW_CLASS} style={{ gridTemplateColumns: SERVICE_COLUMNS }}>
            <span role="cell" className="text-slate-800">Cộng {items.length} dịch vụ hàng đầu</span>
            <span role="cell" className="text-right tabular-nums text-slate-900">{totalCount.toLocaleString('vi-VN')}</span>
            <span role="cell" className="text-right tabular-nums text-blue-600">{formatVnd(totalAmount)}</span>
            <span role="cell" className="text-xs font-normal text-slate-500">chiếm {shareOfServiceAmountPercent}%</span>
          </div>
        </div>
      )}
    </ReportPanel>
  );
}

function QueuePanel({ data }: { data: OwnerDashboard }) {
  const { rows, totalInProgress, totalWaiting, longestWaitMinutes, doctorsInProgress } = data.queue;
  return (
    <ReportPanel title="Hàng đợi hiện tại">
      {rows.length === 0 ? (
        <EmptyLine>Hiện không có lượt khám nào đang chờ hoặc đang khám.</EmptyLine>
      ) : (
        <div role="table" aria-label="Hàng đợi hiện tại" className="text-sm">
          <div role="row" className={HEAD_CLASS} style={{ gridTemplateColumns: QUEUE_COLUMNS }}>
            <span role="columnheader">Phòng</span>
            <span role="columnheader">Bác sĩ</span>
            <span role="columnheader" className="text-right">Đang khám</span>
            <span role="columnheader" className="text-right">Chờ</span>
            <span role="columnheader" className="text-right">Chờ lâu nhất</span>
          </div>
          {rows.map((row, index) => {
            const pool = row.doctorName === null;
            const waitHigh = (row.longestWaitMinutes ?? 0) >= 20;
            return (
              <div role="row" key={`${row.doctorName ?? 'pool'}-${index}`} className={ROW_CLASS} style={{ gridTemplateColumns: QUEUE_COLUMNS }}>
                <span role="cell" className={`${CELL_TEXT} font-medium text-slate-800`}>{row.roomName ?? (pool ? 'Hàng chờ chung' : '—')}</span>
                <span role="cell" className={`${CELL_TEXT} ${pool ? 'text-slate-500' : 'text-slate-600'}`}>{row.doctorName ?? 'Chưa có bác sĩ'}</span>
                <span role="cell" className="text-right font-medium tabular-nums text-blue-600">{row.inProgress}</span>
                <span role="cell" className={`text-right tabular-nums ${waitHigh ? 'font-medium text-amber-600' : 'text-slate-700'}`}>{row.waiting}</span>
                <span role="cell" className={`text-right tabular-nums ${waitHigh ? 'font-medium text-amber-600' : 'text-slate-500'}`}>
                  {row.longestWaitMinutes === null ? <span className="text-slate-400">—</span> : formatWait(row.longestWaitMinutes)}
                </span>
              </div>
            );
          })}
          <div role="row" className={TOTAL_ROW_CLASS} style={{ gridTemplateColumns: QUEUE_COLUMNS }}>
            <span role="cell" className="text-slate-800">Toàn phòng khám</span>
            <span role="cell" className="font-normal text-slate-500">{doctorsInProgress} bác sĩ đang khám</span>
            <span role="cell" className="text-right tabular-nums text-blue-600">{totalInProgress}</span>
            <span role="cell" className="text-right tabular-nums text-slate-900">{totalWaiting}</span>
            <span role="cell" className={`text-right tabular-nums ${(longestWaitMinutes ?? 0) >= 20 ? 'text-amber-600' : 'text-slate-600'}`}>
              {longestWaitMinutes === null ? '—' : formatWait(longestWaitMinutes)}
            </span>
          </div>
        </div>
      )}
    </ReportPanel>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Đang tải số liệu">
      <Skeleton className="h-[148px] w-full rounded-xl" />
      <div className="flex flex-wrap gap-4">
        <Skeleton className="h-64 flex-[999_1_600px]" />
        <Skeleton className="h-64 flex-[1_1_340px]" />
      </div>
      <div className="flex flex-wrap gap-4">
        <Skeleton className="h-60 flex-[999_1_560px]" />
        <Skeleton className="h-60 flex-[1_1_360px]" />
      </div>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

/**
 * Trang Tổng quan của CHỦ PHÒNG KHÁM (một chi nhánh đang làm việc) — docs/DECISIONS.md #279, mockup "Chủ phòng khám" đã chốt 02/11/2026. Máy chủ tính mọi số; trang chỉ hiển thị.
 * Số chỉ tải khi vào trang / đổi kỳ / bấm "Làm mới" và ghi rõ "Số lúc HH:MM" (điểm chốt 7).
 */
export function OwnerDashboardPage() {
  useBreadcrumb([{ label: 'Tổng quan' }]);
  const [period, setPeriod] = useState<DashboardPeriodKind>('today');
  const query = useOwnerDashboardQuery(period);
  const header = useClinicPrintHeaderQuery();
  const data = query.data;
  const clinicName = header.data?.name ?? '';

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{periodTitle(period)}</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {data ? formatWeekdayDate(data.period.to) : ''}
            {data && clinicName ? ' · ' : ''}
            {clinicName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedToggle items={DASHBOARD_PERIOD_ITEMS} value={period} onChange={setPeriod} ariaLabel="Chọn kỳ" />
          {data && <span className="text-[13px] tabular-nums text-slate-500">Số lúc {formatClockTime(data.generatedAt)}</span>}
          <Button type="button" variant="secondary" onClick={() => void query.refetch()} loading={query.isFetching && !query.isLoading}>
            <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
            Làm mới
          </Button>
        </div>
      </div>

      {query.isError && (
        <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được số liệu tổng quan.'} onRetry={() => void query.refetch()} />
      )}

      {!data && !query.isError && <DashboardSkeleton />}

      {data && (
        <>
          <KpiRow data={data} />
          <div className="flex flex-wrap gap-4">
            <HourlyPanel data={data} />
            <GroupPanel data={data} />
          </div>
          <div className="flex flex-wrap gap-4">
            <DailyPanel data={data} />
            <AttentionPanel data={data} />
          </div>
          <ServicesPanel data={data} />
          <QueuePanel data={data} />
        </>
      )}
    </div>
  );
}
