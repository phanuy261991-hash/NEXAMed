import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarCheck, CalendarPlus, ClipboardText, Copy, DownloadSimple, Eye, MagnifyingGlass } from '@phosphor-icons/react';
import type { FollowUpItem, FollowUpTabKind } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { copyText } from '../../shared/format/clipboard';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useInfiniteScrollSentinel } from '../../shared/hooks/useInfiniteScrollSentinel';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { AccessDeniedState } from '../../shared/ui/AccessDeniedState';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ListLoadError } from '../../shared/ui/ListLoadError';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { TabBar } from '../../shared/ui/TabBar';
import { useDoctorsQuery } from '../appointment/appointment.queries';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useDataScope, useHasPermission } from '../auth/usePermission';
import { useFollowUpFeatureEnabledQuery } from '../clinic/clinic.queries';
import { FollowUpReminderDialog } from './FollowUpReminderDialog';
import { FOLLOW_UP_REMINDER_RESULT_LABEL, FOLLOW_UP_STATUS_BADGE, FOLLOW_UP_STATUS_LABEL, bookingHref, canRemind, dueLabel, formatDmy, formatPhone, parseFollowUpTab } from './follow-up-model';
import { useExportFollowUpsMutation, useFollowUpsQuery } from './follow-up.queries';

const GRID_COLUMNS = '112px minmax(0, 1.6fr) minmax(0, 1.4fr) 112px minmax(0, 1.3fr) 168px';
/** Tổng bề rộng tối thiểu của bảng (px) — hẹp hơn thì cuộn ngang (ui-guidelines 9c). */
const TABLE_MIN_WIDTH_PX = 980;
const ROW_HEIGHT_PX = 60;

const EMPTY_TEXT: Record<FollowUpTabKind, { title: string; description: string }> = {
  today: { title: 'Hôm nay không có hẹn tái khám', description: 'Các hẹn tái khám đến hạn hôm nay sẽ hiện ở đây.' },
  overdue: { title: 'Không có hẹn quá hạn', description: 'Hẹn đã qua ngày mà bệnh nhân chưa quay lại (30 ngày gần nhất) sẽ hiện ở đây.' },
  upcoming: { title: 'Không có hẹn trong 7 ngày tới', description: 'Hẹn tái khám trong 7 ngày tới sẽ hiện ở đây.' },
  all: { title: 'Chưa có hẹn tái khám nào', description: 'Bác sĩ chọn "Hẹn tái khám" và ký kế hoạch điều trị thì hẹn sẽ hiện ở đây.' },
};

/** Ô lọc theo bác sĩ — tách thành thành phần riêng để chỉ gọi danh sách bác sĩ khi người xem có quyền (hook không đặt có điều kiện). */
function DoctorFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const doctors = useDoctorsQuery();
  const options = useMemo(
    () => [{ value: '', label: 'Mọi bác sĩ' }, ...(doctors.data?.items ?? []).map((d) => ({ value: d.id, label: d.displayName ?? d.fullName }))],
    [doctors.data],
  );
  return (
    <div className="w-[190px]">
      <Combobox id="follow-up-doctor" value={value} options={options} onChange={onChange} placeholder="Mọi bác sĩ" />
    </div>
  );
}

function dueColor(item: FollowUpItem, today: string): string {
  if (item.followUpDate === today) return 'text-brand-teal';
  return item.followUpDate < today ? 'text-rose-600' : 'text-slate-600';
}

/**
 * Trang "Hẹn tái khám" (docs/DECISIONS.md #285, mockup đã chốt 04/11/2026) — danh sách theo mẫu List Screen Pattern (ui-guidelines mục 9): các kế hoạch điều trị đã ký có hướng "Hẹn tái khám"
 * của chi nhánh đang làm việc, chia tab Hôm nay / Quá hạn / Sắp tới / Tất cả (nhớ trong `?tab=`), kèm nhật ký nhắc. Lễ tân gọi nhắc, ghi lại, đặt lịch hẹn; bác sĩ chỉ thấy hẹn của mình.
 */
export function FollowUpListPage() {
  useBreadcrumb([{ label: 'Tiếp nhận và Đặt lịch' }, { label: 'Hẹn tái khám' }]);
  const feature = useFollowUpFeatureEnabledQuery();
  // Công tắc "Dùng Hẹn tái khám" tắt: không tải danh sách, báo rõ và có lối về. Không tải được công tắc thì cứ vào trang (máy chủ vẫn chặn nếu tắt thật).
  if (feature.isPending) return <div className="p-4"><Skeleton className="h-10 w-full" /></div>;
  if (feature.data?.enabled === false) {
    return <AccessDeniedState title="Phòng khám không dùng Hẹn tái khám" description="Tính năng này đang tắt ở Cấu hình phòng khám. Quản trị viên có thể bật lại ở mục Cấu hình chung." />;
  }
  return <FollowUpListContent />;
}

function FollowUpListContent() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseFollowUpTab(searchParams.get('tab'));
  const [q, setQ] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [reminderFor, setReminderFor] = useState<FollowUpItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const mayRemind = useHasPermission('follow_up', 'remind');
  const mayBook = useHasPermission('appointment', 'create');
  const mayOpenPatient = useHasPermission('patient', 'read');
  const followUpScope = useDataScope('follow_up', 'read');
  const mayReadAppointments = useHasPermission('appointment', 'read');
  const mayFilterDoctor = followUpScope === 'global' && mayReadAppointments;

  const debouncedQ = useDebouncedValue(q, 300);
  const filter = { tab, q: debouncedQ, doctorId };
  const query = useFollowUpsQuery(filter);
  const exportMutation = useExportFollowUpsMutation();
  const today = getVietnamTodayDateString();

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const counts = query.data?.pages[0]?.counts;
  // Đọc cờ lỗi tải-thêm và hàm tải-thêm trước khi `query` bị thu hẹp kiểu theo nhánh hiển thị bên dưới.
  const nextPageFailed = query.isFetchNextPageError;
  const fetchMore = () => void query.fetchNextPage();
  const sentinelRef = useInfiniteScrollSentinel({
    enabled: (query.hasNextPage ?? false) && !query.isFetchingNextPage && !query.isError,
    onReach: fetchMore,
    watchKey: items.length,
  });

  function setTab(next: FollowUpTabKind) {
    setSearchParams(next === 'today' ? {} : { tab: next }, { replace: true });
  }

  async function handleCopy(item: FollowUpItem) {
    if (await copyText(item.phone)) {
      setCopiedId(item.encounterId);
      window.setTimeout(() => setCopiedId((cur) => (cur === item.encounterId ? null : cur)), 1500);
    }
  }

  async function handleExport() {
    setExportError(null);
    try {
      await exportMutation.mutateAsync(filter);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Không xuất được tệp Excel, vui lòng thử lại.');
    }
  }

  const tabs = [
    { id: 'today' as const, label: `Hôm nay${counts ? ` (${counts.today})` : ''}` },
    { id: 'overdue' as const, label: `Quá hạn${counts ? ` (${counts.overdue})` : ''}` },
    { id: 'upcoming' as const, label: `Sắp tới 7 ngày${counts ? ` (${counts.upcoming})` : ''}` },
    { id: 'all' as const, label: 'Tất cả' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <h1 className="sr-only">Hẹn tái khám</h1>

      <div className="flex flex-wrap items-center gap-3">
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
        <span className="flex-grow" />
        {mayFilterDoctor && <DoctorFilter value={doctorId} onChange={setDoctorId} />}
        <div className="relative w-[260px]">
          <MagnifyingGlass size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label="Tìm tên, mã BN, SĐT"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm tên, mã BN, SĐT..."
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <Button type="button" variant="secondary" loading={exportMutation.isPending} onClick={() => void handleExport()}>
          <DownloadSimple size={16} weight="bold" aria-hidden="true" />
          Xuất Excel
        </Button>
      </div>

      {exportError && <ErrorBanner message={exportError} />}

      {query.isPending ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-busy="true" aria-label="Đang tải danh sách hẹn tái khám">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ListLoadError error={query.error} fallbackMessage="Không tải được danh sách hẹn tái khám." onRetry={() => void query.refetch()} fallbackTo="/" fallbackLabel="Về Tổng quan" />
      ) : items.length === 0 ? (
        <EmptyState icon={CalendarCheck} title={debouncedQ.trim() !== '' || doctorId !== '' ? 'Không có hẹn nào khớp bộ lọc' : EMPTY_TEXT[tab].title} description={debouncedQ.trim() !== '' || doctorId !== '' ? 'Đổi từ khoá tìm kiếm hoặc bỏ lọc bác sĩ.' : EMPTY_TEXT[tab].description} />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="scroll-hover h-full overflow-x-auto">
            <div role="table" aria-label="Danh sách hẹn tái khám" className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div role="row" style={{ gridTemplateColumns: GRID_COLUMNS }} className="grid flex-shrink-0 gap-x-3 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
                {['Ngày hẹn', 'Bệnh nhân', 'Lượt khám gốc', 'Trạng thái', 'Lần nhắc', 'Thao tác'].map((h) => (
                  <div key={h} role="columnheader" className="py-2.5 text-center">
                    {h}
                  </div>
                ))}
              </div>

              <div className="scroll-hover min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => {
                  const showActions = canRemind(item);
                  return (
                    <div
                      key={item.encounterId}
                      role="row"
                      style={{ gridTemplateColumns: GRID_COLUMNS, height: ROW_HEIGHT_PX }}
                      className="grid items-center gap-x-3 border-b border-slate-100 px-4 text-sm hover:bg-slate-50"
                    >
                      <div role="cell" className="text-center leading-tight">
                        <div className={`font-semibold ${dueColor(item, today)}`}>{dueLabel(item.followUpDate, today)}</div>
                        <div className="text-xs font-medium tabular-nums text-slate-500">{formatDmy(item.followUpDate)}</div>
                      </div>
                      <div role="cell" className="min-w-0 leading-tight">
                        <div className="truncate font-semibold text-slate-900" title={item.patientName}>{item.patientName}</div>
                        <div className="truncate text-xs font-medium text-slate-500">
                          {item.patientCode} · {formatPhone(item.phone)}
                        </div>
                      </div>
                      <div role="cell" className="min-w-0 leading-tight">
                        <div className="truncate font-medium text-slate-900">
                          {formatDmy(item.sourceDate)}
                          {item.doctorName ? ` · ${item.doctorName}` : ''}
                        </div>
                        <div className="truncate text-xs font-medium text-slate-500" title={item.diagnosisName ?? item.encounterNo}>
                          {item.diagnosisName ?? item.encounterNo}
                        </div>
                      </div>
                      <div role="cell" className="text-center">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${FOLLOW_UP_STATUS_BADGE[item.status]}`}>{FOLLOW_UP_STATUS_LABEL[item.status]}</span>
                      </div>
                      <div role="cell" className="min-w-0 text-center leading-tight">
                        {item.reminderCount === 0 || !item.lastReminder ? (
                          <span className="text-slate-400">Chưa nhắc</span>
                        ) : (
                          <>
                            <div className="font-semibold text-slate-900">Đã nhắc {item.reminderCount} lần</div>
                            <div className="truncate text-xs font-medium text-slate-500" title={`${formatShortDateTimeVn(item.lastReminder.remindedAt)} · ${FOLLOW_UP_REMINDER_RESULT_LABEL[item.lastReminder.result]}`}>
                              {formatShortDateTimeVn(item.lastReminder.remindedAt)} · {FOLLOW_UP_REMINDER_RESULT_LABEL[item.lastReminder.result]}
                            </div>
                          </>
                        )}
                      </div>
                      <div role="cell" className="flex items-center justify-center gap-1.5">
                        {mayOpenPatient && <RowActionButton icon={Eye} label="Xem hồ sơ bệnh nhân" tone="neutral" onClick={() => navigate(`/patients/${item.patientId}`)} />}
                        <RowActionButton icon={Copy} label={copiedId === item.encounterId ? 'Đã sao chép số điện thoại' : 'Sao chép số điện thoại'} tone={copiedId === item.encounterId ? 'success' : 'neutral'} onClick={() => void handleCopy(item)} />
                        {showActions && mayBook && <RowActionButton icon={CalendarPlus} label="Đặt lịch hẹn" tone="neutral" onClick={() => navigate(bookingHref(item, today))} />}
                        {showActions && mayRemind && <RowActionButton icon={ClipboardText} label="Ghi lần nhắc" tone="primary" onClick={() => setReminderFor(item)} />}
                      </div>
                    </div>
                  );
                })}
                <div ref={sentinelRef} aria-hidden="true" className="h-px" />
                {query.isFetchingNextPage && <div className="py-3 text-center text-xs text-slate-400">Đang tải thêm…</div>}
                {nextPageFailed && (
                  <div className="p-3">
                    <ErrorBanner message="Không tải thêm được hẹn tái khám." onRetry={fetchMore} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {reminderFor && <FollowUpReminderDialog item={reminderFor} onClose={() => setReminderFor(null)} />}
    </div>
  );
}
