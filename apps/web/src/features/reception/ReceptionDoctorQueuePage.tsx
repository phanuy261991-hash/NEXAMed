import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowsClockwise,
  CalendarCheck,
  CheckCircle,
  ClipboardText,
  Clock,
  MagnifyingGlass,
  MapPinLine,
  Play,
  PlusCircle,
  Star,
  Stethoscope,
  User,
  UsersThree,
  Warning,
  X,
  type Icon,
} from '@phosphor-icons/react';
import type { ReceptionListItem } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
import { useDoctorsQuery } from '../appointment/appointment.queries';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { RoomSessionDialog } from '../clinic/RoomSessionDialog';
import { useMyRoomSessionQuery, useRoomOptionsQuery } from '../clinic/clinic.queries';
import { useReceptionListQuery, useStartConsultationMutation } from './reception.queries';

/** Ngưỡng "chờ lâu" — THUẦN hiển thị (không chặn, không lưu DB), cùng tinh thần
 * `APPOINTMENT_SPAM_CANCELLED_THRESHOLD` (docs/DECISIONS.md #032): ngưỡng cảnh báo mềm sống ở
 * `apps/web`, không phải quy tắc nghiệp vụ cần đồng bộ server. */
const WAIT_WARNING_MINUTES = 30;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
}

function waitMinutes(checkedInAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(checkedInAt).getTime()) / 60_000));
}

/**
 * Tìm theo tên hoặc mã bệnh nhân — bệnh nhân quá nhiều trong 1 cột thì cần tìm lại nhanh (yêu cầu
 * chủ dự án 2026-08-21). Lọc thuần phía client trên dữ liệu đã tải, không gọi API mới.
 *
 * KHÔNG bỏ dấu tiếng Việt (khác PAT-02 `stripVietnameseDiacritics`) — thử tái dùng hàm đó từ
 * `@nexamed/core` nhưng vỡ Rollup production build thật (`vite build` báo lỗi named export
 * `stripVietnameseDiacritics` không phân giải được qua chuỗi `__exportStar` nhiều tầng của
 * package này, khác `@nexamed/shared` hoạt động bình thường) — đây là lần đầu `apps/web` import
 * `@nexamed/core`, chưa từng có tiền lệ. So khớp chữ thường đơn giản đủ dùng cho việc lọc trong 1
 * cột đã tải sẵn (khác PAT-02 tìm toàn bộ CSDL), không đáng đổi lấy rủi ro build vỡ.
 */
function matchesQueueSearch(item: { fullName: string; patientCode: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return item.fullName.toLowerCase().includes(q) || item.patientCode.toLowerCase().includes(q);
}

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
  // Tìm trong từng cột riêng (yêu cầu chủ dự án 2026-08-21) — 3 ô độc lập, không ảnh hưởng lẫn nhau.
  const [waitingSearch, setWaitingSearch] = useState({ open: false, query: '' });
  const [examSearch, setExamSearch] = useState({ open: false, query: '' });
  const [doneSearch, setDoneSearch] = useState({ open: false, query: '' });

  const listQuery = useReceptionListQuery(today, currentUser?.id, true);
  const departmentsQuery = useDepartmentOptionsQuery();
  const doctorsQuery = useDoctorsQuery();
  const startConsultationMutation = useStartConsultationMutation();
  const items = listQuery.data?.items ?? [];

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
              BS. {currentUser?.fullName}
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
                  <WaitingCard key={item.encounterId} item={item} pool={false} loading={startConsultationMutation.isPending} onStart={() => void handleStart(item)} />
                ))}
              </div>
            )}

            {poolFiltered.length > 0 && (
              <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/40 p-2">
                <GroupLabel icon={UsersThree} variant="pool" count={pool.length}>
                  Hàng chờ chung{poolDepartmentName ? ` · ${poolDepartmentName}` : ''}
                </GroupLabel>
                {poolFiltered.map((item) => (
                  <WaitingCard key={item.encounterId} item={item} pool loading={startConsultationMutation.isPending} onStart={() => void handleStart(item)} />
                ))}
              </div>
            )}
          </QueueColumn>

          <QueueColumn
            title="Đang khám"
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
                    <div className="truncate text-[15px] font-extrabold text-slate-900">{item.fullName}</div>
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
                <Button type="button" variant="secondary" className="mt-2.5 w-full" onClick={() => navigate(`/encounters/${item.encounterId}`)}>
                  Tiếp tục khám
                  <ArrowRight size={13} weight="bold" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </QueueColumn>

          <QueueColumn
            title="Đã khám hôm nay"
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
  count,
  accent,
  search,
  onToggleSearch,
  onQueryChange,
  searchPlaceholder,
  children,
}: {
  title: string;
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
        <span className="text-[11.5px] font-bold uppercase tracking-wide text-slate-800">{title}</span>
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

/**
 * Thanh tiêu đề nhóm nền màu đặc (thay dòng chữ nhạt + gạch ngang trước đây) — phản hồi chủ dự án
 * 2026-08-21: ranh giới "Bệnh nhân của tôi" / "Hàng chờ chung" không nổi bật. Mỗi nhóm một màu
 * riêng (xanh dương = của tôi, tím = hàng chờ chung) để phân biệt ngay từ xa, không cần đọc chữ.
 */
function GroupLabel({ icon: IconComponent, variant, count, children }: { icon: Icon; variant: 'personal' | 'pool'; count: number; children: React.ReactNode }) {
  const styles = variant === 'personal' ? 'bg-blue-600' : 'bg-violet-600';
  return (
    <div className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm ${styles}`}>
      <IconComponent size={13} weight="bold" aria-hidden="true" />
      {children}
      <span className="ml-auto rounded-full bg-white/25 px-1.5 py-0.5 text-[10px]">{count}</span>
    </div>
  );
}

function ColumnEmpty({ icon: IconComponent, text }: { icon: Icon; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-8 text-center text-slate-400">
      <IconComponent size={26} weight="light" className="opacity-60" aria-hidden="true" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

/**
 * Viết lại theo đúng mockup (`docs/design/doctor-queue-virtual-queue-mockup.html` `.card`) — bản
 * trước chỉ tô viền/nền cảnh báo "chờ lâu" khi VỪA hàng chờ chung VỪA quá ngưỡng (`overdue && pool`),
 * nên thẻ "của tôi" chờ lâu không có điểm nhấn gì (phát hiện thật qua ảnh chụp chủ dự án gửi,
 * 2026-08-21) — sửa để `overdue` áp dụng cho MỌI thẻ, không phân biệt của tôi/hàng chờ chung. Ưu
 * tiên hiển thị badge "Chờ lâu" (khẩn cấp hơn) khi vừa ưu tiên vừa chờ lâu cùng lúc.
 */
function WaitingCard({
  item,
  pool,
  loading,
  onStart,
}: {
  item: ReceptionListItem;
  pool: boolean;
  loading: boolean;
  onStart: () => void;
}) {
  const minutes = waitMinutes(item.checkedInAt);
  const overdue = minutes >= WAIT_WARNING_MINUTES;
  const criticalState = overdue ? 'overdue' : item.isPriority ? 'priority' : null;

  const borderLeftClass =
    criticalState === 'overdue' ? 'border-l-rose-600' : criticalState === 'priority' ? 'border-l-amber-500' : pool ? 'border-l-blue-400' : 'border-l-slate-300';
  const bgClass = criticalState === 'overdue' ? 'bg-rose-50/60' : criticalState === 'priority' ? 'bg-amber-50/50' : 'bg-white';

  return (
    <article
      className={`rounded-lg border-2 border-l-4 p-3 shadow-sm ${borderLeftClass} ${bgClass} ${
        pool ? 'border-slate-200 border-dashed' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="truncate text-[15px] font-extrabold text-slate-900">{item.fullName}</span>
          <span className="ml-1.5 text-[11px] font-bold text-slate-500">{item.patientCode}</span>
        </div>
        {criticalState === 'overdue' && (
          <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-rose-600 px-2.5 py-1 text-[10.5px] font-bold text-white">
            <Warning size={12} weight="fill" aria-hidden="true" />
            Chờ lâu
          </span>
        )}
        {criticalState === 'priority' && (
          <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[10.5px] font-bold text-white">
            <Star size={12} weight="fill" aria-hidden="true" />
            Ưu tiên
          </span>
        )}
      </div>
      {item.chiefComplaint && (
        <p className="mt-1 truncate text-[12.5px] text-slate-700">
          <span className="font-bold text-slate-900">Lý do: </span>
          {item.chiefComplaint}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px]">
        {item.appointmentId && (
          <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-bold text-blue-700">
            <CalendarCheck size={11} weight="bold" aria-hidden="true" />
            Đặt lịch trước
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 font-bold ${pool ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
          {pool ? 'Chưa gán bác sĩ' : 'Của tôi'}
        </span>
        <span className="flex items-center gap-1 font-semibold text-slate-600">
          <Clock size={11} weight="bold" aria-hidden="true" />
          Tiếp nhận {formatTime(item.checkedInAt)}
        </span>
        <span className={`font-extrabold ${overdue ? 'text-rose-600' : 'text-slate-700'}`}>Chờ {minutes} phút</span>
      </div>
      <Button type="button" variant={pool ? 'secondary' : 'primary'} className="mt-2.5 w-full" loading={loading} onClick={onStart}>
        {pool ? <PlusCircle size={13} weight="bold" aria-hidden="true" /> : <Play size={13} weight="bold" aria-hidden="true" />}
        {pool ? 'Gọi khám — nhận ca này' : 'Bắt đầu khám'}
      </Button>
    </article>
  );
}