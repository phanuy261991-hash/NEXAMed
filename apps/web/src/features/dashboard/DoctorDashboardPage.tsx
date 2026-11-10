import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowClockwise, CheckCircle, Coins, FileText, Stethoscope, UsersThree, WarningCircle } from '@phosphor-icons/react';
import type { DoctorDashboard } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVndPlain } from '../../shared/format/currency';
import { formatClockTime } from '../../shared/format/time';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { useClinicPrintHeaderQuery } from '../../shared/print/clinic-print-header.queries';
import { Button } from '../../shared/ui/Button';
import { ClosePreviousDaysDialog } from '../../shared/ui/ClosePreviousDaysDialog';
import { DashboardKpiRow, type DashboardKpiItem } from '../../shared/ui/dashboard/DashboardKpiRow';
import { DashboardPanel } from '../../shared/ui/dashboard/DashboardPanel';
import { InitialsAvatar } from '../../shared/ui/dashboard/InitialsAvatar';
import { StackedBarStrip } from '../../shared/ui/dashboard/StackedBarStrip';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { useFollowUpFeatureEnabledQuery, useMyClosingStateQuery } from '../clinic/clinic.queries';
import { formatDayMonth, formatWait, formatWeekdayDate } from './dashboard-model';
import { abnormalIndicatorText, averagePerDayText, buildDoctorHourlyChart, doneText, inProgressText, longestWaitText, patientSubtitle, peakText } from './doctor-dashboard-model';
import { LabPartnerAwaitingBlock } from '../lab-partner/LabPartnerAwaitingBlock';
import { useDoctorDashboardQuery } from './dashboard.queries';

/** Màn "Hàng đợi khám" của bác sĩ — nơi thật sự bắt đầu khám/nhận ca (đóng ca, chọn phòng, nhận bệnh nhân đều xử lý ở đó). */
const DOCTOR_QUEUE_PATH = '/reception/doctor-queue';

function EmptyLine({ children }: { children: string }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

/** Giờ hiện tại theo giờ VN (0–23) của thời điểm chụp số — dùng đánh dấu cột giờ hiện tại. */
function vietnamHourOf(iso: string): number {
  return Number(new Date(iso).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 2)) % 24;
}

function ClosingNotice() {
  const user = useAuthStore((s) => s.user);
  // Trạng thái đóng ca cần quyền ghi tạm nghỉ/đóng ca (`doctor_availability.update`); vai trò không có quyền đó (vai trò tuỳ biến) không gọi để khỏi bị 403 thừa.
  const canClose = useHasPermission('doctor_availability', 'update');
  const closingState = useMyClosingStateQuery(canClose);
  const [dialogOpen, setDialogOpen] = useState(false);
  const days = closingState.data?.pendingDays ?? [];

  if (closingState.isError) {
    return <ErrorBanner message="Không kiểm tra được ca ngày trước của bạn." onRetry={() => void closingState.refetch()} />;
  }
  if (days.length === 0 || !user) return null;
  const first = days[0]!;
  return (
    <>
      <div role="region" aria-label="Ca chưa đóng" className="flex items-center gap-3 rounded-2xl bg-amber-50 px-5 py-3.5">
        <WarningCircle size={20} weight="fill" className="flex-none text-amber-500" aria-hidden="true" />
        <p className="min-w-0 flex-grow text-[15px] text-amber-900">
          {days.length === 1 ? `Ca ngày ${first.date.split('-').reverse().join('/')} chưa được đóng.` : `${days.length} ngày chưa được đóng ca (${days.map((d) => formatDayMonth(d.date)).join(', ')}).`} Cần đóng trước khi bắt đầu khám hôm nay.
        </p>
        <Button type="button" variant="amber" className="flex-none whitespace-nowrap rounded-full!" onClick={() => setDialogOpen(true)}>
          {days.length === 1 ? `Đóng ca ngày ${formatDayMonth(first.date)}` : `Đóng ca ${days.length} ngày`}
        </Button>
      </div>
      {dialogOpen && <ClosePreviousDaysDialog doctorId={user.id} days={days} onDone={() => setDialogOpen(false)} onClose={() => setDialogOpen(false)} />}
    </>
  );
}

function KpiRow({ data }: { data: DoctorDashboard }) {
  const items: DashboardKpiItem[] = [
    { icon: FileText, tone: 'blue', label: 'Tổng lượt của tôi', value: data.total.count.toLocaleString('vi-VN'), delta: { direction: 'flat', text: averagePerDayText(data.total.averagePerDay), tone: 'neutral' } },
    { icon: UsersThree, tone: 'blue', label: 'Đang chờ tôi', value: data.waiting.count.toLocaleString('vi-VN'), solid: true, delta: { direction: 'flat', text: longestWaitText(data.waiting.longestWaitMinutes), tone: 'neutral' } },
    { icon: Stethoscope, tone: 'blue', label: 'Đang khám', value: data.inProgress.count.toLocaleString('vi-VN'), delta: { direction: 'flat', text: inProgressText(data.inProgress), tone: 'neutral' } },
    { icon: CheckCircle, tone: 'emerald', label: 'Đã xong', value: data.done.count.toLocaleString('vi-VN'), delta: { direction: 'flat', text: doneText(data.done), tone: 'neutral' } },
    // Chỉ có khi phòng khám bật "Hiện doanh thu sinh ra trên Tổng quan bác sĩ": máy chủ không gửi số tiền khi tắt.
    ...(data.revenue !== null
      ? [{ icon: Coins, tone: 'emerald' as const, label: 'Doanh thu sinh ra', value: formatVndPlain(data.revenue.amount), delta: { direction: 'flat' as const, text: 'gồm cả phiếu chưa thu', tone: 'neutral' as const } }]
      : []),
  ];
  return <DashboardKpiRow items={items} minCardWidth={200} />;
}

function WaitingPanel({ data }: { data: DoctorDashboard }) {
  const navigate = useNavigate();
  const { items, moreCount } = data.waitingList;
  return (
    <DashboardPanel
      title="Bệnh nhân đang chờ tôi"
      badge={data.waiting.count > 0 ? <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white tabular-nums">{data.waiting.count}</span> : undefined}
      action={
        <Link to={DOCTOR_QUEUE_PATH} className="text-blue-600 hover:text-blue-700 hover:underline">
          Mở hàng đợi khám
        </Link>
      }
      className="flex-[999_1_560px]"
    >
      {items.length === 0 ? (
        <EmptyLine>Chưa có bệnh nhân nào đang chờ bạn.</EmptyLine>
      ) : (
        <>
          <ul className="flex flex-col gap-0.5" aria-label="Bệnh nhân đang chờ tôi">
            {items.map((item, index) => (
              <li key={item.encounterId} className={`flex items-center gap-3.5 rounded-xl px-3 py-2.5 ${index === 0 ? 'bg-slate-50' : ''}`}>
                <span className="w-6 flex-none text-[15px] font-semibold tabular-nums text-slate-400">{index + 1}</span>
                <InitialsAvatar name={item.patientName} />
                <div className="min-w-0 flex-grow">
                  <div className="truncate text-[15px] font-medium text-slate-900">{item.patientName}</div>
                  <div className="truncate text-[13px] text-slate-500">{patientSubtitle(item)}</div>
                </div>
                <span className={`w-[72px] flex-none text-right text-sm tabular-nums ${index === 0 ? 'font-medium text-amber-600' : 'text-slate-500'}`}>{formatWait(item.waitMinutes)}</span>
                <span className="flex w-[120px] flex-none justify-end">
                  {index === 0 && (
                    <Button type="button" onClick={() => navigate(DOCTOR_QUEUE_PATH)} className="rounded-full! px-4! py-1.5! text-[13px]" aria-label={`Bắt đầu khám ${item.patientName}`}>
                      Bắt đầu khám
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {moreCount > 0 && (
            <div className="px-3 pt-2 text-[13px] text-slate-500">
              và {moreCount} bệnh nhân khác —{' '}
              <Link to={DOCTOR_QUEUE_PATH} className="text-blue-600 hover:text-blue-700 hover:underline">
                mở hàng đợi khám
              </Link>
            </div>
          )}
        </>
      )}
      {data.commonQueue.count > 0 && (
        <div className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
          <span className="flex-grow">
            Hàng chờ chung có <b className="font-semibold text-slate-900">{data.commonQueue.count.toLocaleString('vi-VN')} người</b> chưa có bác sĩ.
          </span>
          <Link to={DOCTOR_QUEUE_PATH} className="font-medium text-blue-600 hover:text-blue-700 hover:underline">
            Nhận ca
          </Link>
        </div>
      )}
    </DashboardPanel>
  );
}

function UnseenResultsPanel({ data }: { data: DoctorDashboard }) {
  const { count, items, moreCount } = data.unseenResults;
  return (
    <DashboardPanel
      title="Kết quả mới chưa xem"
      badge={count > 0 ? <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white tabular-nums">{count}</span> : undefined}
      className="flex-[1_1_340px]"
    >
      {items.length === 0 ? (
        <EmptyLine>Không có kết quả mới nào cần xem.</EmptyLine>
      ) : (
        <ul className="flex flex-col" aria-label="Kết quả mới chưa xem">
          {items.map((item, index) => (
            <li key={`${item.name}-${item.patientName}-${index}`} className="border-t border-slate-100 first:border-t-0">
              <Link to={DOCTOR_QUEUE_PATH} className="block py-3 text-inherit hover:no-underline">
                <div className="truncate text-[15px] font-medium text-slate-900">{item.name}</div>
                <div className="mt-0.5 truncate text-[13px] text-slate-500">
                  {item.patientName} · {formatClockTime(item.resultedAt)}
                  {abnormalIndicatorText(item.abnormalCount) && <span className="font-semibold text-rose-700"> · {abnormalIndicatorText(item.abnormalCount)}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {moreCount > 0 && <div className="pt-2 text-[13px] text-slate-500">và {moreCount} kết quả khác — xem ở Hàng đợi khám.</div>}
    </DashboardPanel>
  );
}

function HourlyPanel({ data }: { data: DoctorDashboard }) {
  const chart = buildDoctorHourlyChart(data.hourly, vietnamHourOf(data.generatedAt));
  return (
    <DashboardPanel title="Lượt khám của tôi theo giờ" subtitle={peakText(chart.peak)} className="flex-[999_1_520px]">
      {chart.total === 0 ? (
        <EmptyLine>Hôm nay chưa có lượt khám nào.</EmptyLine>
      ) : (
        <StackedBarStrip
          items={chart.items}
          emphasizedIndex={chart.currentIndex}
          ariaLabel={`Lượt khám của tôi theo giờ hôm nay: ${data.hourly.filter((h) => h.count > 0).map((h) => `${h.hour} giờ ${h.count} lượt`).join('; ')}.`}
        />
      )}
    </DashboardPanel>
  );
}

function FollowUpPanel({ data }: { data: DoctorDashboard }) {
  const f = data.followUp;
  // Liên kết sang trang "Hẹn tái khám" (#285) chỉ hiện khi tài khoản được vào trang đó.
  const canOpenList = useHasPermission('follow_up', 'read');
  return (
    <DashboardPanel
      title="Hẹn tái khám của tôi"
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
        <div className={`flex items-center rounded-xl px-3.5 py-3 ${f.overdueNotArrived > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
          <span className={`flex-grow ${f.overdueNotArrived > 0 ? 'text-amber-900' : 'text-slate-500'}`}>
            Quá hạn chưa đến <span className="text-xs text-slate-400">({f.overdueWithinDays} ngày qua)</span>
          </span>
          <span className={`font-semibold tabular-nums ${f.overdueNotArrived > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{f.overdueNotArrived.toLocaleString('vi-VN')}</span>
          {canOpenList && f.overdueNotArrived > 0 && (
            <Link to="/follow-ups?tab=overdue" className="ml-3 text-[13px] font-medium text-blue-600 hover:text-blue-700 hover:underline">
              Xem
            </Link>
          )}
        </div>
      </div>
    </DashboardPanel>
  );
}

/** Khối báo trước tính năng sắp có (chủ dự án chốt giữ, để mờ): không phải nút, không bấm được — báo cáo theo bác sĩ (B2) chưa làm. */
function ComingSoonReportPanel() {
  return (
    <DashboardPanel title="Báo cáo của tôi">
      <p className="text-sm leading-relaxed text-slate-400">Số lượt khám, cơ cấu chẩn đoán và tỉ lệ chỉ định của riêng bạn theo tháng.</p>
      <span className="mt-3 inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[13px] font-medium text-slate-400" aria-label="Báo cáo của tôi: sắp có">
        Sắp có
      </span>
    </DashboardPanel>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Đang tải số liệu">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[108px] rounded-2xl" />
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        <Skeleton className="h-72 flex-[999_1_560px] rounded-2xl" />
        <Skeleton className="h-72 flex-[1_1_340px] rounded-2xl" />
      </div>
      <div className="flex flex-wrap gap-4">
        <Skeleton className="h-56 flex-[999_1_520px] rounded-2xl" />
        <Skeleton className="h-56 flex-[1_1_340px] rounded-2xl" />
      </div>
    </div>
  );
}

/**
 * Trang Tổng quan của BÁC SĨ (docs/DECISIONS.md #279/#286, mockup hướng B đã chốt 04/11/2026): lượt khám của CHÍNH bác sĩ hôm nay — hàng chờ, đang khám, đã xong, kết quả mới chưa xem,
 * theo giờ và hẹn tái khám. Máy chủ tính mọi số; số tiền chỉ hiện khi phòng khám bật công tắc. Số chỉ tải khi vào trang và khi bấm "Làm mới", ghi rõ giờ chụp số.
 */
export function DoctorDashboardPage() {
  useBreadcrumb([{ label: 'Tổng quan' }]);
  const user = useAuthStore((s) => s.user);
  const query = useDoctorDashboardQuery();
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
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{name ? `Chào ${/^(BS\.?|Bác sĩ)\s/i.test(name) ? name : `BS. ${name}`}` : 'Tổng quan'}</h1>
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

      <ClosingNotice />

      {query.isError && (
        <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được số liệu tổng quan.'} onRetry={() => void query.refetch()} />
      )}

      {!data && !query.isError && <DashboardSkeleton />}

      {data && (
        <>
          <KpiRow data={data} />
          <div className="flex flex-wrap gap-4">
            <WaitingPanel data={data} />
            <UnseenResultsPanel data={data} />
          </div>
          <div className="flex flex-wrap gap-4 empty:hidden">
            <LabPartnerAwaitingBlock variant="dashboard" mine />
          </div>
          <div className="flex flex-wrap gap-4">
            <HourlyPanel data={data} />
            <div className="flex flex-[1_1_340px] flex-col gap-4">
              {followUpFeatureEnabled && <FollowUpPanel data={data} />}
              <ComingSoonReportPanel />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
