import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowCounterClockwise,
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  ClipboardText,
  Clock,
  MagnifyingGlass,
  MapPinLine,
  Stethoscope,
  User,
  UsersThree,
  Warning,
  X,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { ReceptionListItem } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { CancelEncounterDialog } from '../../shared/ui/CancelEncounterDialog';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ReleaseEncounterDialog } from '../../shared/ui/ReleaseEncounterDialog';
import { Skeleton } from '../../shared/ui/Skeleton';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
import { useDoctorsQuery, useScheduleConfigQuery } from '../appointment/appointment.queries';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { RoomSessionDialog } from '../clinic/RoomSessionDialog';
import { useMyRoomSessionQuery, useRoomOptionsQuery } from '../clinic/clinic.queries';
import { ColumnEmpty, GroupLabel, WaitingCard, formatTime, matchesQueueSearch, waitMinutes } from './queue-card';
import { useReceptionListQuery, useStartConsultationMutation } from './reception.queries';

/**
 * Fallback trước khi `useScheduleConfigQuery()` tải xong — khớp `DEFAULT_OVERDUE_WAIT_WARNING_MINUTES`
 * ở `@nexamed/shared`, khai riêng ở đây (không import thẳng): hằng số giá trị thuần từ
 * `packages/shared` không export được qua `vite build` (Rollup không dò được named export qua
 * `__exportStar`, dù `tsc`/Vitest/Node `require()` đều thấy đúng) — cùng lỗi bundler đã gặp ở
 * `APPOINTMENT_SPAM_CANCELLED_THRESHOLD`, xem `docs/DECISIONS.md` #032.
 */
const DEFAULT_OVERDUE_WAIT_WARNING_MINUTES = 30;

/**
 * "Hàng đợi khám" — board 3 cột (Đang chờ / Đang khám / Đã khám hôm nay) đúng state machine
 * `encounter`, mô hình "Hàng đợi ảo" (`docs/DECISIONS.md` #064, mockup đã duyệt
 * `docs/design/doctor-queue-virtual-queue-mockup.html`). Cột "Đang chờ" tách 2 nhóm: "Bệnh nhân
 * của tôi" (`doctorId === actor`) và "Hàng chờ chung · {Khoa}" (`doctorId === null`, tự ẩn hoàn
 * toàn khi không có ticket nào — quy mô 1-3 bác sĩ/1 Khoa mặc định sẽ luôn rỗng ở nhóm này). Bác
 * sĩ có `encounter.read = global` (ENC-01) nên LUÔN lọc tường minh theo `doctorId=chính mình` +
 * `includeDepartmentPool=true`, không dựa vào data_scope.
 */
export function ReceptionDoctorQueuePage() {
  useBreadcrumb([{ label: 'Khám bệnh' }, { label: 'Hàng đợi khám' }]);
  const currentUser = useAuthStore((s) => s.user);
  const today = getVietnamTodayDateString();
  const navigate = useNavigate();
  const [rowError, setRowError] = useState<string | null>(null);
  const [claimToast, setClaimToast] = useState<string | null>(null);
  // #085 — "Khách bỏ về"/"Trả về hàng chờ" ngay trên thẻ, không cần chạy sang trang khác.
  const [cancellingItem, setCancellingItem] = useState<ReceptionListItem | null>(null);
  const [releasingItem, setReleasingItem] = useState<ReceptionListItem | null>(null);
  // Tìm trong từng cột riêng (yêu cầu chủ dự án 2026-08-21) — 3 ô độc lập, không ảnh hưởng lẫn nhau.
  const [waitingSearch, setWaitingSearch] = useState({ open: false, query: '' });
  const [examSearch, setExamSearch] = useState({ open: false, query: '' });
  const [doneSearch, setDoneSearch] = useState({ open: false, query: '' });

  const listQuery = useReceptionListQuery(today, currentUser?.id, true, true);
  const departmentsQuery = useDepartmentOptionsQuery(true);
  const doctorsQuery = useDoctorsQuery();
  const scheduleConfigQuery = useScheduleConfigQuery();
  const startConsultationMutation = useStartConsultationMutation();
  const items = listQuery.data?.items ?? [];
  const warningMinutes = scheduleConfigQuery.data?.overdueWaitWarningMinutes ?? DEFAULT_OVERDUE_WAIT_WARNING_MINUTES;

  useEffect(() => {
    if (!claimToast) return;
    const timer = setTimeout(() => setClaimToast(null), 5000);
    return () => clearTimeout(timer);
  }, [claimToast]);

  // "Đang ở phòng nào" (docs/DECISIONS.md #054, nới theo phản hồi 2026-08-21): 0 phòng active thì
  // tự ẩn hoàn toàn dòng phòng. Đúng 1 phòng active thì hiện thẳng tên phòng đó, KHÔNG cần
  // `doctor_room_session` (không có gì để chọn) — ≥2 phòng mới thật sự cần chọn qua session +
  // nút "Đổi phòng". `mySession` chỉ fetch khi ≥2 phòng, cùng nguyên tắc cũ.
  const roomOptionsQuery = useRoomOptionsQuery();
  const roomCount = roomOptionsQuery.data?.items.length ?? 0;
  const multiRoomActive = roomCount > 1;
  const mySessionQuery = useMyRoomSessionQuery(multiRoomActive);
  const [changingRoom, setChangingRoom] = useState(false);
  // Bác sĩ vào thẳng "Hàng đợi khám" mà chưa từng chọn phòng (bỏ qua lúc đăng nhập) — bắt chọn lại
  // NGAY ĐÂY, không cho bỏ qua nữa (đăng nhập thì có thể chỉ để làm việc khác, nhưng vào hàng đợi
  // khám nghĩa là chuẩn bị khám thật, phải có phòng).
  const mustPickRoom = multiRoomActive && mySessionQuery.isSuccess && mySessionQuery.data === null;
  const singleRoomName = roomCount === 1 ? roomOptionsQuery.data?.items[0]?.name : null;

  const selfDoctor = doctorsQuery.data?.items.find((d) => d.id === currentUser?.id);
  const selfDepartmentName = selfDoctor?.departmentId
    ? (departmentsQuery.data?.items.find((d) => d.id === selfDoctor.departmentId)?.name ?? null)
    : null;

  const waiting = items.filter((i) => i.status === 'CHECKED_IN');
  const mine = waiting.filter((i) => i.doctorId === currentUser?.id);
  const pool = waiting.filter((i) => i.doctorId === null);
  const inConsultation = items.filter((i) => i.status === 'IN_CONSULTATION' && i.doctorId === currentUser?.id);
  const doneToday = items
    .filter((i) => i.status === 'COMPLETED' && i.doctorId === currentUser?.id)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const totalHandledToday = mine.length + inConsultation.length + doneToday.length;

  const poolDepartmentName = pool.length > 0 ? (departmentsQuery.data?.items.find((d) => d.id === pool[0]!.departmentId)?.name ?? null) : null;

  // Danh sách đã lọc theo ô tìm kiếm riêng từng cột — huy hiệu số lượng ở đầu cột vẫn hiện TỔNG
  // thật (dùng `mine`/`pool`/... chưa lọc ở trên), chỉ phần thân danh sách đổi theo tìm kiếm.
  const mineFiltered = mine.filter((i) => matchesQueueSearch(i, waitingSearch.query));
  const poolFiltered = pool.filter((i) => matchesQueueSearch(i, waitingSearch.query));
  const inConsultationFiltered = inConsultation.filter((i) => matchesQueueSearch(i, examSearch.query));
  const doneTodayFiltered = doneToday.filter((i) => matchesQueueSearch(i, doneSearch.query));

  async function handleStart(item: ReceptionListItem) {
    setRowError(null);
    try {
      await startConsultationMutation.mutateAsync({ id: item.encounterId, body: { version: item.version } });
      navigate(`/encounters/${item.encounterId}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ENCOUNTER_ALREADY_CLAIMED') {
        setClaimToast(err.message);
        void listQuery.refetch();
        return;
      }
      setRowError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <h1 className="sr-only">Hàng đợi khám</h1>

      {/* Dải phiên làm việc (docs/design/doctor-queue-virtual-queue-mockup.html "session-strip") —
          tên bác sĩ + Khoa + số lượt khám hôm nay LUÔN hiện; dòng phòng chỉ hiện khi tenant có
          ≥1 phòng active (0 phòng thì ẩn hẳn, đúng #054). */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-teal-tint text-brand-teal">
            <Stethoscope size={20} weight="bold" aria-hidden="true" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-slate-900">
              {currentUser?.displayName ?? currentUser?.fullName}
              {selfDepartmentName ? ` · ${selfDepartmentName}` : ''}
            </div>
            {(singleRoomName ?? mySessionQuery.data?.roomName) && (
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <MapPinLine size={12} weight="bold" aria-hidden="true" />
                Đang ở {singleRoomName ?? mySessionQuery.data?.roomName}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{totalHandledToday} lượt khám hôm nay</span>
          {multiRoomActive && mySessionQuery.data && (
            <Button type="button" onClick={() => setChangingRoom(true)}>
              <ArrowsClockwise size={15} weight="bold" aria-hidden="true" />
              Đổi phòng
            </Button>
          )}
        </div>
      </div>

      {(changingRoom || mustPickRoom) && (
        <RoomSessionDialog
          options={roomOptionsQuery.data?.items ?? []}
          currentRoomId={mySessionQuery.data?.roomId}
          dismissible={changingRoom}
          onClose={() => setChangingRoom(false)}
        />
      )}

      {rowError && <ErrorBanner message={rowError} />}

      {listQuery.isPending && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-full rounded-lg" />
          ))}
        </div>
      )}

      {listQuery.isError && (
        <ErrorBanner
          message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được hàng đợi.'}
          onRetry={() => void listQuery.refetch()}
        />
      )}

      {listQuery.isSuccess && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-3">
          <QueueColumn
            title="Đang chờ"
            icon={Clock}
            iconClassName="text-blue-500"
            count={waiting.length}
            accent="border-t-blue-500"
            search={waitingSearch}
            onToggleSearch={() => setWaitingSearch((s) => ({ open: !s.open, query: s.open ? '' : s.query }))}
            onQueryChange={(query) => setWaitingSearch((s) => ({ ...s, query }))}
            searchPlaceholder="Tìm theo tên hoặc mã BN..."
          >
            {waiting.length === 0 && <ColumnEmpty icon={ClipboardText} text="Chưa có bệnh nhân nào chờ khám." />}
            {waiting.length > 0 && mineFiltered.length === 0 && poolFiltered.length === 0 && (
              <ColumnEmpty icon={MagnifyingGlass} text="Không tìm thấy bệnh nhân phù hợp." />
            )}

            {mineFiltered.length > 0 && (
              <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-2">
                <GroupLabel icon={User} variant="personal" count={mine.length}>
                  Bệnh nhân của tôi
                </GroupLabel>
                {mineFiltered.map((item) => (
                  <WaitingCard
                    key={item.encounterId}
                    item={item}
                    pool={false}
                    loading={startConsultationMutation.isPending}
                    warningMinutes={warningMinutes}
                    onStart={() => void handleStart(item)}
                    onCancel={() => setCancellingItem(item)}
                  />
                ))}
              </div>
            )}

            {poolFiltered.length > 0 && (
              <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/40 p-2">
                <GroupLabel icon={UsersThree} variant="pool" count={pool.length}>
                  Hàng chờ chung{poolDepartmentName ? ` · ${poolDepartmentName}` : ''}
                </GroupLabel>
                {poolFiltered.map((item) => (
                  <WaitingCard
                    key={item.encounterId}
                    item={item}
                    pool
                    loading={startConsultationMutation.isPending}
                    warningMinutes={warningMinutes}
                    onStart={() => void handleStart(item)}
                    onCancel={() => setCancellingItem(item)}
                  />
                ))}
              </div>
            )}
          </QueueColumn>

          <QueueColumn
            title="Đang khám"
            icon={Stethoscope}
            iconClassName="text-amber-500"
            count={inConsultation.length}
            accent="border-t-amber-500"
            search={examSearch}
            onToggleSearch={() => setExamSearch((s) => ({ open: !s.open, query: s.open ? '' : s.query }))}
            onQueryChange={(query) => setExamSearch((s) => ({ ...s, query }))}
            searchPlaceholder="Tìm theo tên hoặc mã BN..."
          >
            {inConsultation.length === 0 && <ColumnEmpty icon={ClipboardText} text="Chỉ 1 bệnh nhân đang khám cùng lúc." />}
            {inConsultation.length > 0 && inConsultationFiltered.length === 0 && (
              <ColumnEmpty icon={MagnifyingGlass} text="Không tìm thấy bệnh nhân phù hợp." />
            )}
            {inConsultationFiltered.map((item) => (
              <div key={item.encounterId} className="rounded-lg border-2 border-l-4 border-slate-200 border-l-amber-500 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold text-slate-900">{item.fullName}</div>
                    <div className="text-[11.5px] font-semibold text-slate-500">
                      {item.patientCode} · Bắt đầu lúc {item.startedAt ? formatTime(item.startedAt) : '—'}
                    </div>
                  </div>
                  {item.startedAt && (
                    <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white">
                      <Clock size={12} weight="bold" aria-hidden="true" />
                      {waitMinutes(item.startedAt)} phút
                    </span>
                  )}
                </div>
                {item.chiefComplaint && (
                  <p className="mt-1.5 truncate text-[12.5px] text-slate-700">
                    <span className="font-bold text-slate-900">Lý do: </span>
                    {item.chiefComplaint}
                  </p>
                )}
                {/* #085 — 1 dòng duy nhất: hành động chính (đầy chữ) + 2 nút phụ chỉ-icon, đúng
                    mẫu WaitingCard bên trên (thu ngắn thẻ, tránh 2 dòng nút). "Trả về hàng chờ"
                    (bác sĩ nhận nhầm ca/bận đột xuất) và "Hủy khám" (khách bỏ về giữa chừng) là 2
                    tình huống khác nhau, xem docs/DECISIONS.md #085. */}
                <div className="mt-2.5 flex items-center justify-between gap-1.5">
                  <Button type="button" variant="amber" className="px-3" onClick={() => navigate(`/encounters/${item.encounterId}`)}>
                    Tiếp tục khám
                    <ArrowRight size={13} weight="bold" aria-hidden="true" />
                  </Button>
                  <div className="flex flex-shrink-0 gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-2.5"
                      onClick={() => setReleasingItem(item)}
                      aria-label="Trả về hàng chờ"
                      title="Trả về hàng chờ"
                    >
                      <ArrowCounterClockwise size={15} weight="bold" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      className="px-2.5"
                      onClick={() => setCancellingItem(item)}
                      aria-label="Hủy khám"
                      title="Hủy khám"
                    >
                      <XCircle size={15} weight="bold" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </QueueColumn>

          <QueueColumn
            title="Đã khám hôm nay"
            icon={CheckCircle}
            iconClassName="text-emerald-600"
            count={doneToday.length}
            accent="border-t-emerald-500"
            search={doneSearch}
            onToggleSearch={() => setDoneSearch((s) => ({ open: !s.open, query: s.open ? '' : s.query }))}
            onQueryChange={(query) => setDoneSearch((s) => ({ ...s, query }))}
            searchPlaceholder="Tìm theo tên hoặc mã BN..."
          >
            {doneToday.length === 0 && <ColumnEmpty icon={CheckCircle} text="Chưa có lượt khám nào hoàn tất trong ngày." />}
            {doneToday.length > 0 && doneTodayFiltered.length === 0 && <ColumnEmpty icon={MagnifyingGlass} text="Không tìm thấy bệnh nhân phù hợp." />}
            {doneTodayFiltered.map((item) => (
              <div key={item.encounterId} className="flex items-center justify-between gap-2 border-b border-slate-100 px-1.5 py-2.5 last:border-0">
                <div className="flex min-w-0 items-center gap-2">
                  <CheckCircle size={16} weight="fill" className="flex-shrink-0 text-emerald-500" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-bold text-slate-900">{item.fullName}</div>
                    <div className="text-[11px] font-semibold text-slate-500">{item.encounterNo}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/encounters/${item.encounterId}`)}
                  className="flex-shrink-0 text-xs font-bold text-blue-600 hover:text-blue-700"
                >
                  Xem lại
                </button>
              </div>
            ))}
            {doneToday.length > 0 && <p className="mt-1 px-1 text-[11px] text-slate-400">Chỉ để tra cứu lại trong ca — không có thao tác sửa/in ở đây.</p>}
          </QueueColumn>
        </div>
      )}

      {claimToast && (
        <div className="fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-2.5 rounded-lg border border-slate-200 border-l-4 border-l-amber-500 bg-white p-3.5 shadow-lg">
          <Warning size={17} weight="fill" className="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-slate-800">{claimToast}</p>
        </div>
      )}

      {cancellingItem && (
        <CancelEncounterDialog
          encounterId={cancellingItem.encounterId}
          version={cancellingItem.version}
          onCancelled={() => setCancellingItem(null)}
          onClose={() => setCancellingItem(null)}
        />
      )}

      {releasingItem && (
        <ReleaseEncounterDialog
          encounterId={releasingItem.encounterId}
          patientFullName={releasingItem.fullName}
          version={releasingItem.version}
          onReleased={() => setReleasingItem(null)}
          onClose={() => setReleasingItem(null)}
        />
      )}
    </div>
  );
}

/**
 * Icon tìm kiếm ở đầu mỗi cột (yêu cầu chủ dự án 2026-08-21) — bấm mở ô nhập tìm theo tên/mã bệnh
 * nhân, lọc thuần phía client trong đúng cột đó (`matchesQueueSearch`), không gọi API mới. Huy
 * hiệu số lượng vẫn hiện tổng thật, không đổi theo kết quả tìm.
 */
function QueueColumn({
  title,
  icon: IconComponent,
  iconClassName,
  count,
  accent,
  search,
  onToggleSearch,
  onQueryChange,
  searchPlaceholder,
  children,
}: {
  title: string;
  icon: Icon;
  iconClassName: string;
  count: number;
  accent: string;
  search: { open: boolean; query: string };
  onToggleSearch: () => void;
  onQueryChange: (query: string) => void;
  searchPlaceholder: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-t-[3px] border-slate-200 bg-white shadow-sm ${accent}`}>
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-3.5 py-2.5">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-800">
          <IconComponent size={18} weight="bold" className={iconClassName} aria-hidden="true" />
          {title}
        </span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white">{count}</span>
          <button
            type="button"
            onClick={onToggleSearch}
            title="Tìm bệnh nhân trong danh sách này"
            aria-label="Tìm bệnh nhân trong danh sách này"
            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${
              search.open ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
            }`}
          >
            <MagnifyingGlass size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
      {search.open && (
        <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50 px-2.5 py-2">
          <div className="relative">
            <MagnifyingGlass size={13} weight="bold" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              autoFocus
              type="text"
              value={search.query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-7 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            {search.query !== '' && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                aria-label="Xoá tìm kiếm"
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700"
              >
                <X size={13} weight="bold" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="scroll-hover flex-1 space-y-2 overflow-y-auto p-2.5">{children}</div>
    </section>
  );
}
