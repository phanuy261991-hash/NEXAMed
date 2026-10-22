import { useState } from 'react';
import {
  ArrowsLeftRight,
  CaretLeft,
  CaretRight,
  CheckCircle,
  ClipboardText,
  DownloadSimple,
  HourglassMedium,
  MagnifyingGlass,
  Prohibit,
  Stethoscope,
  Wallet,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import type { DoctorOption, ReceptionListItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useInfiniteScrollSentinel } from '../../shared/hooks/useInfiniteScrollSentinel';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { CancelEncounterDialog } from '../../shared/ui/CancelEncounterDialog';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { InfiniteListFooter, InfiniteScrollTail } from '../../shared/ui/InfiniteListFooter';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { InsuranceBadge } from '../insurance-card/InsuranceBadge';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { useDoctorWorkShiftsQuery, useDoctorsQuery, useScheduleConfigQuery } from '../appointment/appointment.queries';
import { addDays, formatDateLabel, getVietnamTodayDateString, selectGridDoctors } from '../appointment/schedule-grid.utils';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { useDoctorAvailabilityTodayQuery } from '../clinic/clinic.queries';
import { computeAgeLabel } from '../patient/patient-form.utils';
import { ENCOUNTER_STATUS_META } from './encounter-status';
import { doctorAvailabilityBadgeMeta, waitMinutes } from './queue-card';
import { ReassignDoctorDialog } from './ReassignDoctorDialog';
import { useExportReceptionListMutation, useReceptionListInfiniteQuery, useReceptionListQuery } from './reception.queries';

/** Fallback trước khi `useScheduleConfigQuery()` tải xong — khớp `DEFAULT_OVERDUE_WAIT_WARNING_MINUTES`
 * ở `@nexamed/shared`, khai riêng ở đây (Rollup không dò được named export hằng số qua barrel
 * `packages/shared`, cùng lỗi bundler đã ghi ở `ReceptionDoctorQueuePage.tsx`, `docs/DECISIONS.md` #032). */
const DEFAULT_OVERDUE_WAIT_WARNING_MINUTES = 30;

/** Gộp Mã lượt khám + Họ tên + Năm sinh/tuổi + Bác sĩ/Khoa phụ trách + Thao tác (Đổi bác sĩ) —
 * 7 cột thay 10, đúng phản hồi trực tiếp lúc duyệt mockup (bớt cột, gộp thông tin liên quan). */
const GRID_COLUMNS = '36px 1.3fr 105px 1fr 135px 95px 95px';
const TABLE_MIN_WIDTH_PX = 700;
const ROW_HEIGHT_PX = 60;

/** Chỉ huỷ được khi còn "sống" — đã COMPLETED/CANCELLED thì không còn thao tác nào ở đây. */
const CANCELLABLE_STATUSES: ReceptionListItem['status'][] = ['CHECKED_IN', 'IN_CONSULTATION'];

type TabKey = 'ALL' | 'WAITING' | 'IN_PROGRESS' | 'UNPAID' | 'DONE';
type KpiTone = 'slate' | 'amber' | 'emerald' | 'rose' | 'blue' | 'violet';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${vn.getUTCFullYear()} ${hh}:${min}`;
}

/** Trạng thái hiển thị duy nhất (KHÔNG xếp chồng 2 badge, phản hồi trực tiếp): `CHECKED_IN` chưa
 * thu tiền ưu tiên hiện "Chờ thu" — đó là bước lễ tân cần xử lý tiếp theo, không phải "đã tiếp
 * nhận" (đã biết). Các trạng thái khác dùng nguyên `ENCOUNTER_STATUS_META`. */
function resolveStatusBadge(item: ReceptionListItem) {
  if (item.status === 'CHECKED_IN' && item.invoiceStatus === 'UNPAID') {
    return { label: 'Chờ thu', bg: 'bg-amber-500', text: 'text-white' };
  }
  return ENCOUNTER_STATUS_META[item.status];
}

function doctorDisplayName(doctor: DoctorOption): string {
  return doctor.displayName ?? doctor.fullName;
}

/**
 * "Bệnh nhân trong ngày" — nội dung điều phối theo mockup "Trung tâm Điều phối Tiếp nhận" (#135),
 * tên hiển thị đổi lại theo yêu cầu trực tiếp (giữ nguyên tên menu quen thuộc #044, chỉ đổi phần
 * mockup gốc dùng để dựng). Lễ tân theo dõi trạng thái VÀ điều phối bệnh nhân trong ngày: dải KPI
 * tổng quan, bảng kèm trạng thái thanh toán + cảnh báo
 * chờ lâu, panel "Tải theo Bác sĩ" thời gian thực, đổi bác sĩ phụ trách khi cần. Mockup đã duyệt
 * qua nhiều vòng phản hồi trực tiếp — 4 điểm khác mockup HTML tham khảo ban đầu: (1) không có "Chờ
 * Cận lâm sàng" (module ngoài phạm vi v1) — thay bằng "Chờ thanh toán"; (2) điều phối theo BÁC SĨ
 * (đúng "Hàng đợi ảo" #064), không theo Phòng; (3) "Đổi bác sĩ" chỉ áp dụng khi `CHECKED_IN`; (4)
 * không có "Gọi loa" (không có hệ thống PA thật, #094 đã cắt tương tự cho v2).
 */
export function ReceptionListPage() {
  useBreadcrumb([{ label: 'Tiếp nhận và Đặt lịch' }, { label: 'Bệnh nhân trong ngày' }]);

  const [date, setDate] = useState(getVietnamTodayDateString());
  const [activeTab, setActiveTab] = useState<TabKey>('ALL');
  const [search, setSearch] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reassigningId, setReassigningId] = useState<string | null>(null);

  // Danh sách tải THEO LÔ khi cuộn (docs/DECISIONS.md #251): tab + từ khoá lọc ở máy chủ trên CẢ NGÀY; thẻ KPI và số trên tab là số cả ngày do máy chủ trả, không đếm lại trên các dòng đã tải.
  const debouncedSearch = useDebouncedValue(search, 400);
  const listQuery = useReceptionListInfiniteQuery({ date, tab: activeTab, q: debouncedSearch.trim() });
  // Bảng "Tải theo Bác sĩ" chỉ cần các lượt đang chờ/đang khám (ít) — truy vấn riêng, không phân trang.
  const activeQuery = useReceptionListQuery(date, undefined, undefined, undefined, true, 'ACTIVE');
  const exportMutation = useExportReceptionListMutation();
  const doctorsQuery = useDoctorsQuery();
  const availabilityQuery = useDoctorAvailabilityTodayQuery();
  // Panel "Tải theo Bác sĩ" lọc theo ca của NGÀY ĐANG CHỌN (cùng quy tắc lưới Lịch hẹn, #224) — công tắc hiện cả bác sĩ chưa đăng ký ca.
  const doctorWorkShiftsQuery = useDoctorWorkShiftsQuery(date);
  const [showUnregistered, setShowUnregistered] = useState(false);
  const departmentsQuery = useDepartmentOptionsQuery();
  const scheduleConfigQuery = useScheduleConfigQuery();
  const warningMinutes = scheduleConfigQuery.data?.overdueWaitWarningMinutes ?? DEFAULT_OVERDUE_WAIT_WARNING_MINUTES;

  const pages = listQuery.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const dayCounts = pages[0]?.counts;
  const tabCounts = pages[0]?.tabCounts;
  const activeItems = activeQuery.data?.items ?? [];
  const doctors = doctorsQuery.data?.items ?? [];
  const doctorNameById = new Map(doctors.map((d) => [d.id, doctorDisplayName(d)]));
  const departmentNameById = new Map((departmentsQuery.data?.items ?? []).map((d) => [d.id, d.name]));
  const availabilityByDoctorId = new Map((availabilityQuery.data?.items ?? []).map((i) => [i.doctorId, i.status]));

  const kpi = dayCounts ?? { total: 0, waiting: 0, inProgress: 0, unpaid: 0, done: 0, cancelled: 0 };
  const visibleItems = items;
  const cancellingItem = items.find((i) => i.encounterId === cancellingId) ?? null;
  const reassigningItem = items.find((i) => i.encounterId === reassigningId) ?? null;
  const itemIds = visibleItems.map((i) => i.encounterId);
  const rowSelection = useRowSelection(itemIds);
  const hasNextPage = listQuery.hasNextPage;
  const loadMore = () => {
    if (hasNextPage && !listQuery.isFetchingNextPage) void listQuery.fetchNextPage();
  };
  // Lỗi tải thêm: dừng tự tải (tránh vòng lặp lỗi), chờ người dùng bấm "Thử lại".
  const isLoadMoreError = listQuery.isFetchNextPageError;
  const sentinelRef = useInfiniteScrollSentinel({ enabled: hasNextPage && !listQuery.isFetchingNextPage && !isLoadMoreError, onReach: loadMore, watchKey: items.length });
  const currentTabTotal = tabCounts ? { ALL: tabCounts.all, WAITING: tabCounts.waiting, IN_PROGRESS: tabCounts.inProgress, UNPAID: tabCounts.unpaid, DONE: tabCounts.done }[activeTab] : 0;

  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: 'ALL', label: 'Tất cả', count: tabCounts?.all ?? 0 },
    { key: 'WAITING', label: 'Chờ khám', count: tabCounts?.waiting ?? 0 },
    { key: 'IN_PROGRESS', label: 'Đang khám', count: tabCounts?.inProgress ?? 0 },
    { key: 'UNPAID', label: 'Chờ thanh toán', count: tabCounts?.unpaid ?? 0 },
    { key: 'DONE', label: 'Hoàn tất', count: tabCounts?.done ?? 0 },
  ];

  const KPI_ITEMS: { key: string; label: string; value: number; icon: typeof ClipboardText; tone: KpiTone }[] = [
    { key: 'total', label: 'Tổng đăng ký', value: kpi.total, icon: ClipboardText, tone: 'slate' },
    { key: 'waiting', label: 'Đang chờ khám', value: kpi.waiting, icon: HourglassMedium, tone: 'amber' },
    { key: 'inProgress', label: 'Đang khám', value: kpi.inProgress, icon: Stethoscope, tone: 'emerald' },
    { key: 'unpaid', label: 'Chờ thanh toán', value: kpi.unpaid, icon: Wallet, tone: 'rose' },
    { key: 'done', label: 'Đã hoàn tất', value: kpi.done, icon: CheckCircle, tone: 'blue' },
    { key: 'cancelled', label: 'Đã huỷ', value: kpi.cancelled, icon: Prohibit, tone: 'violet' },
  ];
  // Thẻ KPI phẳng, KHÔNG đổ bóng, KHÔNG nền pha màu mờ (chủ dự án 16/10/2026: "bóng mờ màu sắc nhìn không hiện đại, không sắc nét"): nền trắng + viền slate mảnh, màu CHỈ nằm ở ô biểu tượng
  // nền ĐẶC (đúng token tín hiệu ở ui-guidelines mục 2.1a) — con số luôn slate-900 cho nét đậm, dễ đọc.
  const KPI_TONE_CLASSES: Record<KpiTone, { iconBg: string }> = {
    slate: { iconBg: 'bg-slate-700' },
    amber: { iconBg: 'bg-amber-500' },
    emerald: { iconBg: 'bg-emerald-500' },
    rose: { iconBg: 'bg-rose-500' },
    blue: { iconBg: 'bg-blue-600' },
    violet: { iconBg: 'bg-violet-500' },
  };

  /** Panel "Tải theo Bác sĩ" — bác sĩ đã đóng ca (ENDED) nhưng còn bệnh nhân đang chờ gán lên đầu
   * (cần điều phối lại gấp nhất), rồi tới bác sĩ đang bận (chờ/đang khám nhiều nhất), cuối cùng
   * mới tới bác sĩ rảnh/tạm nghỉ. */
  const panelSelection = selectGridDoctors({
    doctors,
    shiftsByDoctor: doctorWorkShiftsQuery.data?.byDoctorId ?? {},
    leaveByDoctor: doctorWorkShiftsQuery.data?.leaveByDoctorId ?? {},
    // Bác sĩ còn bệnh nhân trong ngày vẫn hiện dù không có ca, để không mất điều phối.
    appointments: (activeQuery.data?.doctorIdsWithEncounters ?? []).map((doctorId) => ({ doctorId, status: 'CHECKED_IN' })),
    showUnregistered,
  });
  const unregisteredTotal = doctors.filter((d) => (doctorWorkShiftsQuery.data?.byDoctorId[d.id] ?? []).length === 0).length;
  const doctorLoad = panelSelection.doctors
    .map((doctor) => {
      const status = availabilityByDoctorId.get(doctor.id) ?? 'ACTIVE';
      const waitingItems = activeItems.filter((i) => i.doctorId === doctor.id && i.status === 'CHECKED_IN');
      const inProgressItems = activeItems.filter((i) => i.doctorId === doctor.id && i.status === 'IN_CONSULTATION');
      const stuck = status === 'ENDED' && waitingItems.length > 0;
      return { doctor, status, waitingItems, inProgressItems, stuck };
    })
    .sort((a, b) => {
      if (a.stuck !== b.stuck) return a.stuck ? -1 : 1;
      const busyA = a.waitingItems.length + a.inProgressItems.length;
      const busyB = b.waitingItems.length + b.inProgressItems.length;
      if (busyA !== busyB) return busyB - busyA;
      return a.doctor.fullName.localeCompare(b.doctor.fullName);
    });

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Bệnh nhân trong ngày</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2.5 px-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDate((d) => addDays(d, -1))}
            aria-label="Ngày trước"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <span className="min-w-[168px] rounded-md border border-slate-300 px-3.5 py-1.5 text-center text-[13.5px] font-semibold text-slate-900">
            {formatDateLabel(date)}
          </span>
          <button
            type="button"
            onClick={() => setDate((d) => addDays(d, 1))}
            aria-label="Ngày sau"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretRight size={15} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => setDate(getVietnamTodayDateString())}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            Hôm nay
          </button>
        </div>
        <Button type="button" variant="secondary" loading={exportMutation.isPending} onClick={() => exportMutation.mutate(date)}>
          <DownloadSimple size={16} weight="bold" aria-hidden="true" />
          Xuất Excel
        </Button>
      </div>

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isError && (
        <ErrorBanner
          message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được dữ liệu điều phối tiếp nhận.'}
          onRetry={() => void listQuery.refetch()}
        />
      )}

      {listQuery.isSuccess && (
        <>
          {/* Dải KPI — kiểu thẻ riêng + icon khung màu, theo yêu cầu trực tiếp (khác dải liền khối
              `StatCardRow` dùng ở Thu ngân/Sổ quỹ — CHỈ áp dụng cục bộ cho trang này, #128). */}
          <div className="flex-shrink-0 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {KPI_ITEMS.map((kpiItem) => {
              const tone = KPI_TONE_CLASSES[kpiItem.tone];
              return (
                <div key={kpiItem.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">{kpiItem.label}</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{kpiItem.value}</p>
                  </div>
                  <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-white ${tone.iconBg}`}>
                    <kpiItem.icon size={22} weight="bold" aria-hidden="true" />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 xl:grid-cols-[1fr_336px]">
            {/* LEFT: filter tabs + bảng */}
            <div className="flex min-h-0 min-w-0 flex-col gap-2.5">
              <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  {TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                        activeTab === tab.key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  ))}
                </div>
                <div className="relative w-full max-w-[220px]">
                  <MagnifyingGlass size={14} weight="bold" className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" aria-hidden="true" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm tên, mã LK, SĐT..."
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 py-1.5 pl-8 pr-3 text-xs focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              </div>

              {visibleItems.length === 0 ? (
                <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <EmptyState
                    icon={ClipboardText}
                    title="Không có lượt khám nào khớp"
                    description="Đổi bộ lọc, từ khoá tìm kiếm, hoặc chọn ngày khác."
                  />
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div role="table" aria-label="Bệnh nhân trong ngày" className="scroll-hover min-h-0 flex-1 overflow-x-auto">
                    <div className="flex h-full w-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
                      <div
                        role="row"
                        style={{ gridTemplateColumns: GRID_COLUMNS }}
                        className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800"
                      >
                        <div role="columnheader" className="flex items-center justify-center py-2.5">
                          <SelectionCheckbox
                            checked={rowSelection.allLoadedSelected}
                            indeterminate={rowSelection.someLoadedSelected}
                            onChange={rowSelection.toggleAll}
                            ariaLabel="Chọn tất cả"
                          />
                        </div>
                        <div role="columnheader" className="py-2.5 text-center">Mã LK / Bệnh nhân</div>
                        <div role="columnheader" className="py-2.5 text-center">SĐT</div>
                        <div role="columnheader" className="py-2.5 text-center">Bác sĩ / Khoa phụ trách</div>
                        <div role="columnheader" className="py-2.5 text-center">Giờ tiếp nhận</div>
                        <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                        <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
                      </div>

                      <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                        {visibleItems.map((item) => {
                          const badge = resolveStatusBadge(item);
                          const minutes = waitMinutes(item.checkedInAt);
                          const overdue = item.status === 'CHECKED_IN' && minutes >= warningMinutes;
                          const doctorEnded = item.doctorId !== null && availabilityByDoctorId.get(item.doctorId) === 'ENDED';
                          const dimmed = item.status === 'COMPLETED' || item.status === 'CANCELLED' || item.status === 'NO_SHOW';
                          return (
                            <div
                              key={item.encounterId}
                              role="row"
                              style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}
                              className={`grid items-center border-b border-slate-100 px-4 text-sm ${
                                dimmed ? 'bg-slate-50/50' : doctorEnded ? 'bg-rose-50/40 hover:bg-rose-50/70' : 'hover:bg-blue-50/40'
                              }`}
                            >
                              <div role="cell" className="flex items-center justify-center">
                                <SelectionCheckbox
                                  checked={rowSelection.isSelected(item.encounterId)}
                                  onChange={() => rowSelection.toggle(item.encounterId)}
                                  ariaLabel={`Chọn ${item.fullName}`}
                                />
                              </div>
                              <div role="cell" className="min-w-0 truncate">
                                <div className="flex items-center gap-1.5">
                                  <span className={`truncate font-semibold ${dimmed ? 'text-slate-600' : 'text-slate-800'}`}>{item.encounterNo}</span>
                                  <span className="flex-none"><InsuranceBadge badge={item.insurance} /></span>
                                </div>
                                <div className={`truncate text-[13px] font-semibold ${dimmed ? 'text-slate-500' : 'text-slate-600'}`}>
                                  {item.fullName} <span className="font-medium text-slate-400">· {item.dob.slice(0, 4)} · {computeAgeLabel(item.dob)}</span>
                                </div>
                              </div>
                              <div role="cell" className={`text-center tabular-nums font-semibold ${dimmed ? 'text-slate-500' : 'text-slate-600'}`}>{item.phone}</div>
                              <div role="cell" className="min-w-0 text-center">
                                {item.doctorId ? (
                                  <>
                                    <div className={`truncate text-sm font-semibold ${dimmed ? 'text-slate-600' : 'text-slate-700'}`}>
                                      {doctorNameById.get(item.doctorId) ?? '—'}
                                    </div>
                                    {doctorEnded ? (
                                      <div className="truncate text-xs font-semibold text-rose-600">⚠ Đã đóng ca</div>
                                    ) : (
                                      <div className={`truncate text-xs font-medium ${dimmed ? 'text-slate-400' : 'text-slate-500'}`}>{departmentNameById.get(item.departmentId) ?? ''}</div>
                                    )}
                                  </>
                                ) : (
                                  <span className="inline-flex max-w-full items-center truncate rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                    Chưa gán · {departmentNameById.get(item.departmentId) ?? ''}
                                  </span>
                                )}
                              </div>
                              <div role="cell" className="text-center">
                                <div className={`tabular-nums font-semibold ${dimmed ? 'text-slate-500' : 'text-slate-600'}`}>{formatDateTime(item.checkedInAt)}</div>
                                {item.status === 'CHECKED_IN' &&
                                  (overdue ? (
                                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                      <Warning size={10} weight="fill" aria-hidden="true" />
                                      Chờ lâu · {minutes} phút
                                    </div>
                                  ) : (
                                    <div className="mt-1 text-xs font-semibold text-slate-500">Chờ {minutes} phút</div>
                                  ))}
                              </div>
                              <div role="cell" className="text-center">
                                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.bg} ${badge.text}`}>{badge.label}</span>
                              </div>
                              <div role="cell" className="flex items-center justify-center gap-1.5">
                                {item.status === 'CHECKED_IN' && (
                                  <Button
                                    type="button"
                                    variant="info"
                                    className="flex-shrink-0 px-2.5"
                                    onClick={() => setReassigningId(item.encounterId)}
                                    aria-label="Đổi bác sĩ"
                                    title="Đổi bác sĩ"
                                  >
                                    <ArrowsLeftRight size={14} weight="bold" aria-hidden="true" />
                                  </Button>
                                )}
                                {CANCELLABLE_STATUSES.includes(item.status) && (
                                  <Button
                                    type="button"
                                    variant="danger"
                                    className="flex-shrink-0 px-2.5"
                                    onClick={() => setCancellingId(item.encounterId)}
                                    aria-label="Hủy"
                                    title="Hủy"
                                  >
                                    <XCircle size={14} weight="bold" aria-hidden="true" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <InfiniteScrollTail sentinelRef={sentinelRef} hasNextPage={hasNextPage} isFetchingNextPage={listQuery.isFetchingNextPage} />
                      </div>
                    </div>
                  </div>
                  <InfiniteListFooter
                    loaded={items.length}
                    total={currentTabTotal}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={listQuery.isFetchingNextPage}
                    isLoadMoreError={isLoadMoreError}
                    onRetry={() => void listQuery.fetchNextPage()}
                  />
                </div>
              )}
            </div>

            {/* RIGHT: panel "Tải theo Bác sĩ" */}
            <aside className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                  Tải theo Bác sĩ
                </h2>
              </div>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
                {panelSelection.dayUsesShifts && (panelSelection.hiddenUnregisteredCount > 0 || showUnregistered) && (
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700">
                    <input type="checkbox" checked={showUnregistered} onChange={(e) => setShowUnregistered(e.target.checked)} className="h-4 w-4 accent-blue-600" />
                    Hiện cả bác sĩ chưa đăng ký ca
                    <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{unregisteredTotal}</span>
                  </label>
                )}
                {doctorsQuery.isPending && <p className="px-1 text-xs text-slate-400">Đang tải...</p>}
                {!doctorsQuery.isPending && doctorLoad.length === 0 && <p className="px-1 text-xs text-slate-400">Chưa có bác sĩ nào.</p>}
                {doctorLoad.map(({ doctor, status, waitingItems, inProgressItems, stuck }) => {
                  const badge = doctorAvailabilityBadgeMeta(status);
                  const idle = waitingItems.length === 0 && inProgressItems.length === 0;
                  const cardClass = stuck
                    ? 'border-2 border-rose-300 bg-rose-50/50'
                    : waitingItems.length > 0
                      ? 'border border-amber-200 bg-amber-50/30'
                      : inProgressItems.length > 0 || (idle && status === 'ACTIVE')
                        ? 'border border-emerald-200 bg-emerald-50/20'
                        : 'border border-slate-200 bg-slate-50 opacity-80';
                  const dotClass = status === 'BREAK' ? 'bg-amber-500' : status === 'ENDED' ? 'bg-slate-400' : 'bg-emerald-500';
                  return (
                    <div key={doctor.id} className={`rounded-lg p-3 ${cardClass}`}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${dotClass}`} aria-hidden="true" title={badge.label} />
                          <span className="truncate text-[15px] font-semibold text-slate-800">{doctorDisplayName(doctor)}</span>
                        </div>
                        {waitingItems.length > 0 ? (
                          <span className="flex-shrink-0 rounded px-2 py-0.5 text-xs font-semibold bg-amber-500 text-white">Chờ: {waitingItems.length} BN</span>
                        ) : (
                          status !== 'ACTIVE' && <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
                        )}
                      </div>
                      <div className="mb-2 truncate text-xs font-medium text-slate-500">
                        {doctor.departmentId ? (departmentNameById.get(doctor.departmentId) ?? '') : 'Chưa gán Khoa'}
                        {doctor.currentRoomName && (
                          <>
                            {' '}
                            · Phòng <span className="font-semibold text-slate-700">{doctor.currentRoomName}</span>
                          </>
                        )}
                      </div>

                      {inProgressItems.length > 0 && (
                        <div className="space-y-1">
                          {inProgressItems.map((item) => (
                            <div key={item.encounterId} className="rounded border border-slate-200 bg-white p-2 text-xs">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Đang khám</div>
                              <div className="flex items-center justify-between font-semibold text-slate-800">
                                <span className="truncate">{item.fullName}</span>
                                <span className="tabular-nums flex-shrink-0 font-semibold text-emerald-600">{waitMinutes(item.startedAt ?? item.checkedInAt)} phút</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {stuck && (
                        <div className="flex items-center gap-1.5 rounded border border-rose-300 bg-white px-2 py-1.5 text-xs font-semibold text-rose-700">
                          <Warning size={14} weight="fill" className="flex-shrink-0" aria-hidden="true" />
                          Còn {waitingItems.length} bệnh nhân đang gán — cần đổi bác sĩ
                        </div>
                      )}

                      {idle && status === 'ACTIVE' && (
                        <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white p-2 text-xs font-semibold text-emerald-600">
                          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                          Sẵn sàng tiếp nhận bệnh nhân mới
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>
          </div>
        </>
      )}

      <SelectionToolbar count={rowSelection.selectedCount} onClear={rowSelection.clear} />

      {cancellingItem && (
        <CancelEncounterDialog
          encounterId={cancellingItem.encounterId}
          version={cancellingItem.version}
          onCancelled={() => setCancellingId(null)}
          onClose={() => setCancellingId(null)}
        />
      )}

      {reassigningItem && (
        <ReassignDoctorDialog
          encounterId={reassigningItem.encounterId}
          patientFullName={reassigningItem.fullName}
          version={reassigningItem.version}
          currentDoctorId={reassigningItem.doctorId}
          onReassigned={() => setReassigningId(null)}
          onClose={() => setReassigningId(null)}
        />
      )}
    </div>
  );
}
