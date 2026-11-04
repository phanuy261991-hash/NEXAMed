import { Link, useNavigate } from 'react-router-dom';
import { ArrowClockwise, CalendarBlank, CheckCircle, Clock, UserPlus, UsersThree, WarningCircle } from '@phosphor-icons/react';
import type { ReceptionDashboard } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatClockTime } from '../../shared/format/time';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { useClinicPrintHeaderQuery } from '../../shared/print/clinic-print-header.queries';
import { Button } from '../../shared/ui/Button';
import { DashboardKpiRow, type DashboardKpiItem } from '../../shared/ui/dashboard/DashboardKpiRow';
import { DashboardPanel, DashboardTotalRow } from '../../shared/ui/dashboard/DashboardPanel';
import { InitialsAvatar } from '../../shared/ui/dashboard/InitialsAvatar';
import { StackedBarStrip } from '../../shared/ui/dashboard/StackedBarStrip';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { useFollowUpFeatureEnabledQuery } from '../clinic/clinic.queries';
import { appointmentHref, buildHourlyAppointments, leaveAlertSentence, leaveAlertsTotal, upcomingSubtitle, withDoctorTitle } from './reception-dashboard-model';
import { formatWeekdayDate } from './dashboard-model';
import { useReceptionDashboardQuery } from './dashboard.queries';

function EmptyLine({ children }: { children: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

/** Giờ hiện tại theo giờ VN (0–23) của thời điểm chụp số — dùng đánh dấu cột giờ hiện tại. */
function vietnamHourOf(iso: string): number {
  return Number(new Date(iso).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 2)) % 24;
}

function LeaveAlerts({ data }: { data: ReceptionDashboard }) {
  if (data.leaveAlerts.length === 0) return null;
  const total = leaveAlertsTotal(data.leaveAlerts);
  return (
    <div role="region" aria-label="Bác sĩ nghỉ phép" className="flex items-center gap-3 rounded-2xl bg-amber-50 px-5 py-3.5">
      <WarningCircle size={20} weight="fill" className="flex-none text-amber-500" aria-hidden="true" />
      <div className="min-w-0 flex-grow">
        {data.leaveAlerts.map((alert) => (
          <p key={`${alert.doctorName}-${alert.startMinute}`} className="text-[15px] text-amber-900">
            {leaveAlertSentence(alert)}
          </p>
        ))}
      </div>
      <Link to="/appointments" className="flex-none text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline">
        Xem {total} lịch hẹn
      </Link>
    </div>
  );
}

function KpiRow({ data }: { data: ReceptionDashboard }) {
  const items: DashboardKpiItem[] = [
    { icon: CalendarBlank, tone: 'blue', label: 'Lịch hẹn hôm nay', value: data.appointments.total.toLocaleString('vi-VN') },
    { icon: CheckCircle, tone: 'emerald', label: 'Đã đến', value: data.appointments.arrived.toLocaleString('vi-VN') },
    { icon: Clock, tone: 'amber', label: 'Chưa đến', value: data.appointments.notArrived.toLocaleString('vi-VN') },
    { icon: UsersThree, tone: 'blue', label: 'Đang chờ khám', value: data.waiting.toLocaleString('vi-VN'), solid: true },
    { icon: UserPlus, tone: 'violet', label: 'Khám mới / tái khám', value: `${data.reception.newCount.toLocaleString('vi-VN')} / ${data.reception.returnCount.toLocaleString('vi-VN')}` },
  ];
  return <DashboardKpiRow items={items} minCardWidth={180} />;
}

function UpcomingPanel({ data }: { data: ReceptionDashboard }) {
  const navigate = useNavigate();
  const { items, moreCount } = data.upcoming;
  // Nút hành động chỉ ở lịch đầu tiên chưa bị vướng bác sĩ nghỉ (đúng mockup); lịch của bác sĩ nghỉ có liên kết "Đổi bác sĩ"; các dòng còn lại bấm cả dòng/Enter để mở chi tiết.
  const firstReadyIndex = items.findIndex((i) => !i.doctorOnLeave);
  return (
    <DashboardPanel
      title="Lịch hẹn sắp tới"
      action={
        <Link to="/appointments" className="text-blue-600 hover:text-blue-700 hover:underline">
          Mở lịch hẹn
        </Link>
      }
      className="flex-[999_1_560px]"
    >
      {items.length === 0 ? (
        <EmptyLine>Không còn lịch hẹn nào chưa đến.</EmptyLine>
      ) : (
        <>
          <ul className="flex flex-col gap-0.5" aria-label="Lịch hẹn sắp tới">
            {items.map((item, index) => {
              const href = appointmentHref(data.date, item.appointmentId);
              return (
                <li
                  key={item.appointmentId}
                  tabIndex={0}
                  title="Mở chi tiết lịch hẹn"
                  className={`flex cursor-pointer items-center gap-3.5 rounded-xl px-3 py-2.5 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none ${index === firstReadyIndex ? 'bg-slate-50' : ''}`}
                  onClick={() => navigate(href)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(href);
                  }}
                >
                  <span className="w-12 flex-none text-[15px] font-semibold tabular-nums text-slate-900">{formatClockTime(item.scheduledAt)}</span>
                  <InitialsAvatar name={item.patientName} />
                  <div className="min-w-0 flex-grow">
                    <div className="truncate text-[15px] font-medium text-slate-900">{item.patientName}</div>
                    <div className="truncate text-[13px] text-slate-500">
                      {upcomingSubtitle(item)}
                      {item.doctorOnLeave && <span className="font-medium text-amber-700"> · nghỉ phép</span>}
                    </div>
                  </div>
                  <span className="flex w-[92px] flex-none justify-end">
                    {item.doctorOnLeave ? (
                      <Link to={appointmentHref(data.date, item.appointmentId, 'reschedule')} onClick={(e) => e.stopPropagation()} className="text-[13px] font-medium text-blue-600 hover:text-blue-700 hover:underline">
                        Đổi bác sĩ
                      </Link>
                    ) : (
                      index === firstReadyIndex && (
                        <Button type="button" onClick={(e) => { e.stopPropagation(); navigate(href); }} className="rounded-full! px-4! py-1.5! text-[13px]" aria-label={`Tiếp nhận ${item.patientName}`}>
                          Tiếp nhận
                        </Button>
                      )
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {moreCount > 0 && (
            <div className="px-3 pt-2 text-[13px] text-slate-500">
              và {moreCount} lịch hẹn khác —{' '}
              <Link to="/appointments" className="text-blue-600 hover:text-blue-700 hover:underline">
                mở lịch hẹn
              </Link>
            </div>
          )}
        </>
      )}
    </DashboardPanel>
  );
}

function QueuePanel({ data }: { data: ReceptionDashboard }) {
  const { rows, totalInProgress, totalWaiting } = data.queue;
  return (
    <DashboardPanel title="Hàng đợi theo bác sĩ" className="flex-[1_1_340px]">
      {rows.length === 0 ? (
        <EmptyLine>Hiện không có lượt khám nào đang chờ hoặc đang khám.</EmptyLine>
      ) : (
        <>
          <div role="table" aria-label="Hàng đợi theo bác sĩ" className="text-[15px]">
            <div role="row" className="flex items-center gap-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <span role="columnheader" className="flex-grow">Bác sĩ</span>
              <span role="columnheader" className="w-[84px] text-right">Đang khám</span>
              <span role="columnheader" className="w-12 text-right">Chờ</span>
            </div>
            {rows.map((row, index) => (
              <div role="row" key={`${row.doctorName ?? 'pool'}-${index}`} className="flex items-center gap-2.5 border-t border-slate-100 py-3">
                <span role="cell" className={`min-w-0 flex-grow truncate ${row.doctorName ? 'font-medium text-slate-900' : 'text-slate-500'}`}>
                  {row.doctorName ? withDoctorTitle(row.doctorName) : 'Chưa có bác sĩ'}
                </span>
                <span role="cell" className="w-[84px] text-right font-semibold tabular-nums text-blue-600">{row.inProgress}</span>
                <span role="cell" className="w-12 text-right tabular-nums text-slate-800">{row.waiting}</span>
              </div>
            ))}
          </div>
          <DashboardTotalRow>
            <span className="flex-grow text-slate-800">Cộng</span>
            <span className="w-[84px] text-right tabular-nums text-blue-600">{totalInProgress}</span>
            <span className="w-12 text-right tabular-nums text-slate-900">{totalWaiting}</span>
          </DashboardTotalRow>
        </>
      )}
    </DashboardPanel>
  );
}

function HourlyPanel({ data }: { data: ReceptionDashboard }) {
  const chart = buildHourlyAppointments(data.hourly, vietnamHourOf(data.generatedAt));
  const legend = (className: string, label: string) => (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-500">
      <span aria-hidden="true" className={`size-2.5 rounded-[3px] ${className}`} />
      {label}
    </span>
  );
  return (
    <DashboardPanel
      title="Lịch hẹn theo giờ"
      action={
        <span className="flex items-center gap-3.5">
          {legend('bg-emerald-500', 'Đã đến')}
          {legend('bg-amber-300', 'Chưa đến')}
        </span>
      }
      className="flex-[999_1_560px]"
    >
      {chart.total === 0 ? (
        <EmptyLine>Hôm nay không có lịch hẹn nào.</EmptyLine>
      ) : (
        <StackedBarStrip
          items={chart.items}
          emphasizedIndex={chart.currentIndex}
          ariaLabel={`Lịch hẹn theo giờ hôm nay: ${data.hourly.filter((h) => h.arrived + h.notArrived > 0).map((h) => `${h.hour} giờ ${h.arrived} đã đến, ${h.notArrived} chưa đến`).join('; ')}.`}
        />
      )}
    </DashboardPanel>
  );
}

function FollowUpPanel({ data }: { data: ReceptionDashboard }) {
  const f = data.followUp;
  // Liên kết sang trang "Hẹn tái khám" (#285) chỉ hiện khi tài khoản được vào trang đó.
  const canOpenList = useHasPermission('follow_up', 'read');
  const overdueRowClass = `flex items-center rounded-xl px-3.5 py-3 ${f.overdueNotArrived > 0 ? 'bg-amber-50' : 'bg-slate-50'}`;
  const overdueRow = (
    <>
      <span className={`flex-grow ${f.overdueNotArrived > 0 ? 'text-amber-900' : 'text-slate-500'}`}>
        Quá hạn chưa đến <span className="text-xs text-slate-400">({f.overdueWithinDays} ngày qua)</span>
      </span>
      <span className={`font-semibold tabular-nums ${f.overdueNotArrived > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{f.overdueNotArrived.toLocaleString('vi-VN')}</span>
    </>
  );
  return (
    <DashboardPanel
      title="Hẹn tái khám hôm nay"
      className="flex-[1_1_340px]"
      action={
        canOpenList ? (
          <Link to="/follow-ups" className="text-blue-600 hover:text-blue-700 hover:underline">
            Xem tất cả
          </Link>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-1 text-[15px]">
        <div className="flex items-center py-2.5">
          <span className="flex-grow text-slate-500">Hẹn hôm nay</span>
          <span className="font-semibold tabular-nums text-slate-900">{f.dueToday.toLocaleString('vi-VN')}</span>
        </div>
        <div className="flex items-center py-2.5">
          <span className="flex-grow text-slate-500">Đã đến</span>
          <span className="font-semibold tabular-nums text-emerald-600">{f.arrivedToday.toLocaleString('vi-VN')}</span>
        </div>
        {canOpenList ? (
          <Link to="/follow-ups?tab=overdue" className={`${overdueRowClass} hover:bg-amber-100`}>
            {overdueRow}
          </Link>
        ) : (
          <div className={overdueRowClass}>{overdueRow}</div>
        )}
      </div>
    </DashboardPanel>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Đang tải số liệu">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[108px] rounded-2xl" />
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        <Skeleton className="h-72 flex-[999_1_560px] rounded-2xl" />
        <Skeleton className="h-72 flex-[1_1_340px] rounded-2xl" />
      </div>
      <div className="flex flex-wrap gap-4">
        <Skeleton className="h-56 flex-[999_1_560px] rounded-2xl" />
        <Skeleton className="h-56 flex-[1_1_340px] rounded-2xl" />
      </div>
    </div>
  );
}

/**
 * Trang Tổng quan của LỄ TÂN (docs/DECISIONS.md #279/#284, mockup "Lễ tân" hướng B đã chốt 04/11/2026): lịch hẹn hôm nay (đã đến/chưa đến), hàng đợi theo bác sĩ, lịch hẹn sắp tới,
 * bác sĩ nghỉ phép cần đổi lịch và hẹn tái khám. Máy chủ tính mọi số; không có số tiền. Số chỉ tải khi vào trang và khi bấm "Làm mới", ghi rõ giờ chụp số.
 */
export function ReceptionDashboardPage() {
  useBreadcrumb([{ label: 'Tổng quan' }]);
  const user = useAuthStore((s) => s.user);
  const query = useReceptionDashboardQuery();
  const header = useClinicPrintHeaderQuery();
  // Phòng khám tắt "Dùng Hẹn tái khám" (#285) thì ẩn khối hẹn tái khám (chưa tải xong cũng ẩn, tránh nháy).
  const followUpFeatureEnabled = useFollowUpFeatureEnabledQuery().data?.enabled ?? false;
  const data = query.data;
  const clinicName = header.data?.name ?? '';
  const name = user?.displayName ?? user?.fullName ?? '';

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
        <Button type="button" variant="secondary" className="rounded-full! ring-0!" onClick={() => void query.refetch()} loading={query.isFetching && !query.isLoading}>
          <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
          Làm mới{data ? <span className="tabular-nums text-slate-500"> · {formatClockTime(data.generatedAt)}</span> : null}
        </Button>
      </div>

      {query.isError && (
        <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được số liệu tổng quan.'} onRetry={() => void query.refetch()} />
      )}

      {!data && !query.isError && <DashboardSkeleton />}

      {data && (
        <>
          <LeaveAlerts data={data} />
          <KpiRow data={data} />
          <div className="flex flex-wrap gap-4">
            <UpcomingPanel data={data} />
            <QueuePanel data={data} />
          </div>
          <div className="flex flex-wrap gap-4">
            <HourlyPanel data={data} />
            {followUpFeatureEnabled && <FollowUpPanel data={data} />}
          </div>
        </>
      )}
    </div>
  );
}
