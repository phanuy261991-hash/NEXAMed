import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowClockwise, CheckCircle, Clock, MinusCircle, Money } from '@phosphor-icons/react';
import type { CashierDashboard, CashierShiftDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVndPlain } from '../../shared/format/currency';
import { formatClockTime } from '../../shared/format/time';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { useClinicPrintHeaderQuery } from '../../shared/print/clinic-print-header.queries';
import { Button } from '../../shared/ui/Button';
import { BarStrip } from '../../shared/ui/dashboard/BarStrip';
import { DashboardKpiRow, type DashboardKpiItem } from '../../shared/ui/dashboard/DashboardKpiRow';
import { DashboardPanel, DashboardTotalRow } from '../../shared/ui/dashboard/DashboardPanel';
import { InitialsAvatar } from '../../shared/ui/dashboard/InitialsAvatar';
import { formatMillions } from '../../shared/ui/charts/chart-scale';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { CloseShiftDialog } from '../cashier-shift/CloseShiftDialog';
import { OpenShiftDialog } from '../cashier-shift/OpenShiftDialog';
import { useCurrentCashierShiftQuery } from '../cashier-shift/cashier-shift.queries';
import { buildCashBoxRows, buildHourlyChart, labelWithCount, pendingInvoiceHref } from './cashier-dashboard-model';
import { formatWeekdayDate } from './dashboard-model';
import { useCashierDashboardQuery, useDashboardShiftSummaryQuery } from './dashboard.queries';

/** Màu thanh/chấm từng phương thức thanh toán, xoay vòng theo thứ tự (đã sắp theo số tiền giảm dần). */
const METHOD_COLORS = ['bg-blue-600', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-400'] as const;

function EmptyLine({ children }: { children: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

function KpiRow({ data }: { data: CashierDashboard }) {
  const items: DashboardKpiItem[] = [
    { icon: Clock, tone: 'amber', label: labelWithCount('Chờ thu', data.pending.invoiceCount), value: formatVndPlain(data.pending.amount) },
    { icon: CheckCircle, tone: 'emerald', label: labelWithCount('Đã thu', data.collected.invoiceCount), value: formatVndPlain(data.collected.amount) },
    { icon: MinusCircle, tone: 'rose', label: labelWithCount('Đã hoàn', data.refunded.invoiceCount), value: formatVndPlain(data.refunded.amount) },
    { icon: Money, tone: 'blue', label: 'Thực thu', value: formatVndPlain(data.net), solid: true },
  ];
  return <DashboardKpiRow items={items} />;
}

function PendingPanel({ data, className }: { data: CashierDashboard; className: string }) {
  const navigate = useNavigate();
  const { items, invoiceCount, amount, moreCount } = data.pending;
  return (
    <DashboardPanel
      title="Phiếu chờ thu"
      badge={invoiceCount > 0 ? <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-amber-700">{invoiceCount}</span> : undefined}
      action={
        <Link to="/billing" className="text-blue-600 hover:text-blue-700 hover:underline">
          Mở danh sách cần thu
        </Link>
      }
      className={className}
    >
      {items.length === 0 ? (
        <EmptyLine>Không có phiếu nào đang chờ thu.</EmptyLine>
      ) : (
        <>
          <ul className="flex flex-col gap-0.5" aria-label="Phiếu chờ thu">
            {items.map((item, index) => (
              <li
                key={item.invoiceId}
                tabIndex={0}
                title="Mở phiếu thu"
                className={`flex cursor-pointer items-center gap-3.5 rounded-xl px-3 py-2.5 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none ${index === 0 ? 'bg-slate-50' : ''}`}
                onClick={() => navigate(pendingInvoiceHref(item))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigate(pendingInvoiceHref(item));
                }}
              >
                <InitialsAvatar name={item.patientName} />
                <div className="min-w-0 flex-grow">
                  <div className="truncate text-[15px] font-medium text-slate-900">{item.patientName}</div>
                  <div className="truncate text-[13px] text-slate-500">
                    {item.invoiceNo}
                    {item.summary && ` · ${item.summary}`}
                  </div>
                </div>
                <span className="text-[15px] font-semibold tabular-nums text-amber-600">{formatVndPlain(item.dueAmount)}</span>
                {/* Đúng mockup: nút hành động chỉ ở phiếu đầu danh sách (chờ lâu nhất); các dòng còn lại bấm cả dòng/Enter để mở phiếu. */}
                <span className="flex w-[88px] flex-none justify-end">
                  {index === 0 && (
                    <Button type="button" onClick={(e) => { e.stopPropagation(); navigate(pendingInvoiceHref(item)); }} className="rounded-full! px-4! py-1.5! text-[13px]" aria-label={`Thu tiền ${item.patientName}`}>
                      Thu tiền
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {moreCount > 0 && (
            <div className="px-3 pt-2 text-[13px] text-slate-500">
              và {moreCount} phiếu khác —{' '}
              <Link to="/billing" className="text-blue-600 hover:text-blue-700 hover:underline">
                mở danh sách cần thu
              </Link>
            </div>
          )}
          <DashboardTotalRow>
            <span className="flex-grow text-slate-800">Cộng {invoiceCount} phiếu chờ thu</span>
            <span className="tabular-nums text-amber-600">{formatVndPlain(amount)}</span>
          </DashboardTotalRow>
        </>
      )}
    </DashboardPanel>
  );
}

function CashBoxPanel({ shift, onRetry, className }: { shift: CashierShiftDetail; onRetry: () => void; className: string }) {
  const summaryQuery = useDashboardShiftSummaryQuery(shift.id, true);
  const summary = summaryQuery.data;
  const rows = summary ? buildCashBoxRows(shift.openingFloatActual, summary) : [];
  return (
    <DashboardPanel title="Tiền mặt dự kiến trong két" className={className}>
      {summaryQuery.isError ? (
        <ErrorBanner message={summaryQuery.error instanceof ApiError ? summaryQuery.error.message : 'Không tải được số tiền mặt trong két.'} onRetry={() => { void summaryQuery.refetch(); onRetry(); }} />
      ) : !summary ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Đang tải số tiền trong két">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      ) : (
        <>
          <div className="text-[15px]">
            {rows.map((row) => (
              <div key={row.key} className="flex gap-2.5 py-2.5">
                <span className="flex-grow text-slate-500">{row.label}</span>
                <span className={`tabular-nums ${row.direction === 'plus' ? 'text-emerald-700' : row.direction === 'minus' ? 'text-rose-700' : 'text-slate-800'}`}>
                  {row.direction === 'plus' ? '+ ' : row.direction === 'minus' ? '− ' : ''}
                  {formatVndPlain(row.amount)}
                </span>
              </div>
            ))}
          </div>
          <DashboardTotalRow tone="blue">
            <span className="flex-grow text-slate-900">Dự kiến trong két</span>
            <span className="text-xl tabular-nums text-blue-600">{formatVndPlain(summary.expectedCashAmount)}</span>
          </DashboardTotalRow>
        </>
      )}
    </DashboardPanel>
  );
}

function HourlyPanel({ data }: { data: CashierDashboard }) {
  const chart = buildHourlyChart(data.hourly);
  return (
    <DashboardPanel
      title="Tiền thu theo giờ"
      subtitle={chart.peakHour !== null ? `đông nhất ${String(chart.peakHour).padStart(2, '0')}:00 — ${formatMillions(chart.peakAmount)} triệu` : undefined}
      className="flex-[999_1_520px]"
    >
      {chart.peakIndex === null ? (
        <EmptyLine>Chưa có khoản thu nào hôm nay.</EmptyLine>
      ) : (
        <BarStrip
          items={chart.items}
          peakIndex={chart.peakIndex}
          ariaLabel={`Tiền thu theo giờ, triệu đồng: ${chart.items.filter((i) => i.value > 0).map((i) => `${Number(i.label)} giờ ${i.valueLabel}`).join('; ')}.`}
        />
      )}
    </DashboardPanel>
  );
}

function MethodPanel({ data }: { data: CashierDashboard }) {
  const paymentCount = data.byMethod.reduce((s, m) => s + m.paymentCount, 0);
  return (
    <DashboardPanel title="Đã thu theo phương thức" className="flex-[1_1_380px]">
      {data.byMethod.length === 0 ? (
        <EmptyLine>Chưa có khoản thu nào hôm nay.</EmptyLine>
      ) : (
        <>
          <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full" role="presentation">
            {data.byMethod.map((m, i) => (
              <div key={m.methodCode} className={METHOD_COLORS[i % METHOD_COLORS.length]} style={{ flex: Math.max(m.amount, 1) }} />
            ))}
          </div>
          <ul className="mt-4 flex flex-col gap-3 text-[15px]" aria-label="Đã thu theo phương thức">
            {data.byMethod.map((m, i) => (
              <li key={m.methodCode} className="flex items-center gap-2.5">
                <span aria-hidden="true" className={`size-2.5 flex-none rounded-[3px] ${METHOD_COLORS[i % METHOD_COLORS.length]}`} />
                <span className="min-w-0 flex-grow truncate" title={m.methodName}>
                  {m.methodName} <span className="text-slate-400">· {m.paymentCount.toLocaleString('vi-VN')} lượt</span>
                </span>
                <span className="font-medium tabular-nums text-slate-900">{formatVndPlain(m.amount)}</span>
              </li>
            ))}
          </ul>
          <DashboardTotalRow>
            <span className="flex-grow text-slate-800">Cộng · {paymentCount.toLocaleString('vi-VN')} lượt</span>
            <span className="tabular-nums text-blue-600">{formatVndPlain(data.collected.amount)}</span>
          </DashboardTotalRow>
        </>
      )}
    </DashboardPanel>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Đang tải số liệu">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[108px] rounded-2xl" />
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        <Skeleton className="h-72 flex-[999_1_560px] rounded-2xl" />
        <Skeleton className="h-72 flex-[1_1_340px] rounded-2xl" />
      </div>
      <div className="flex flex-wrap gap-4">
        <Skeleton className="h-60 flex-[999_1_520px] rounded-2xl" />
        <Skeleton className="h-60 flex-[1_1_380px] rounded-2xl" />
      </div>
    </div>
  );
}

/**
 * Trang Tổng quan của THU NGÂN (docs/DECISIONS.md #279/#283, mockup "Thu ngân" + phong cách hướng B đã chốt 04/11/2026): tiền hôm nay của chi nhánh, phiếu chờ thu, tiền mặt dự kiến
 * trong két của ca đang mở, tiền thu theo giờ và theo phương thức. Máy chủ tính mọi số; khối ca/két dùng lại endpoint Chốt ca sẵn có và chỉ hiện khi người xem có quyền `cashier_shift`.
 * Số chỉ tải khi vào trang và khi bấm "Làm mới", ghi rõ "Số lúc HH:MM".
 */
export function CashierDashboardPage() {
  useBreadcrumb([{ label: 'Tổng quan' }]);
  const user = useAuthStore((s) => s.user);
  const canReadShift = useHasPermission('cashier_shift', 'read');
  const canOpenShift = useHasPermission('cashier_shift', 'create');
  const query = useCashierDashboardQuery();
  const shiftQuery = useCurrentCashierShiftQuery(canReadShift);
  const header = useClinicPrintHeaderQuery();
  // Chụp lại đúng ca đang chốt tại thời điểm bấm nút: chốt ca xong thì `openShift` về null ngay, hộp thoại không được phụ thuộc vào nó (cùng cách `InvoiceListPage`).
  const [closingShift, setClosingShift] = useState<CashierShiftDetail | null>(null);
  const [openDialogVisible, setOpenDialogVisible] = useState(false);

  const data = query.data;
  const openShift = shiftQuery.data?.openShift ?? null;
  const clinicName = header.data?.name ?? '';
  const name = user?.displayName ?? user?.fullName ?? '';
  const refreshing = (query.isFetching && !query.isLoading) || (shiftQuery.isFetching && !shiftQuery.isLoading);

  const refresh = () => {
    void query.refetch();
    if (canReadShift) void shiftQuery.refetch();
  };

  const showCashBox = canReadShift && openShift !== null;
  const pendingClass = showCashBox ? 'flex-[999_1_560px]' : 'flex-[1_1_100%]';

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{name ? `Chào ${name}` : 'Tổng quan'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data ? formatWeekdayDate(data.date) : ''}
            {data && clinicName ? ' · ' : ''}
            {clinicName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canReadShift && shiftQuery.isSuccess && (
            <>
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-slate-600">
                <span aria-hidden="true" className={`size-2 rounded-full ${openShift ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                {openShift ? (
                  <span>
                    {openShift.shiftLabel} · mở <span className="tabular-nums text-slate-900">{formatClockTime(openShift.openedAt)}</span> · vốn đầu ca{' '}
                    <span className="tabular-nums text-slate-900">{formatVndPlain(openShift.openingFloatActual)}</span>
                  </span>
                ) : (
                  <span>Chưa mở ca</span>
                )}
              </span>
              {openShift ? (
                <Button type="button" variant="amberSolid" className="rounded-full! px-5!" onClick={() => setClosingShift(openShift)}>
                  Chốt ca
                </Button>
              ) : (
                canOpenShift && (
                  <Button type="button" variant="secondary" className="rounded-full! ring-0!" onClick={() => setOpenDialogVisible(true)}>
                    Mở ca
                  </Button>
                )
              )}
            </>
          )}
          <Button type="button" variant="secondary" className="rounded-full! ring-0!" onClick={refresh} loading={refreshing}>
            <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
            Làm mới{data ? <span className="tabular-nums text-slate-500"> · {formatClockTime(data.generatedAt)}</span> : null}
          </Button>
        </div>
      </div>

      {canReadShift && shiftQuery.isError && (
        <ErrorBanner message={shiftQuery.error instanceof ApiError ? shiftQuery.error.message : 'Không tải được thông tin ca thu ngân.'} onRetry={() => void shiftQuery.refetch()} />
      )}

      {query.isError && (
        <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được số liệu tổng quan.'} onRetry={() => void query.refetch()} />
      )}

      {!data && !query.isError && <DashboardSkeleton />}

      {data && (
        <>
          <KpiRow data={data} />
          <div className="flex flex-wrap gap-4">
            <PendingPanel data={data} className={pendingClass} />
            {showCashBox && <CashBoxPanel shift={openShift} onRetry={refresh} className="flex-[1_1_340px]" />}
          </div>
          <div className="flex flex-wrap gap-4">
            <HourlyPanel data={data} />
            <MethodPanel data={data} />
          </div>
        </>
      )}

      {openDialogVisible && shiftQuery.isSuccess && !openShift && (
        <OpenShiftDialog previousClosedShift={shiftQuery.data.previousClosedShift} onCancel={() => setOpenDialogVisible(false)} onSuccess={() => setOpenDialogVisible(false)} />
      )}
      {closingShift && <CloseShiftDialog shift={closingShift} onClose={() => setClosingShift(null)} />}
    </div>
  );
}
