import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle, ClipboardText, MapPinLine, Play, PlusCircle, Warning, type Icon } from '@phosphor-icons/react';
import type { ReceptionListItem } from '@nexamed/shared';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
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

  const listQuery = useReceptionListQuery(today, currentUser?.id, true);
  const departmentsQuery = useDepartmentOptionsQuery();
  const startConsultationMutation = useStartConsultationMutation();
  const items = listQuery.data?.items ?? [];

  useEffect(() => {
    if (!claimToast) return;
    const timer = setTimeout(() => setClaimToast(null), 5000);
    return () => clearTimeout(timer);
  }, [claimToast]);

  // "Đang ở phòng nào" (docs/DECISIONS.md #054) — 0-1 phòng active thì tự ẩn hoàn toàn, cùng logic
  // RoomSessionGate.tsx (không lặp query khi tenant chưa dùng mô hình nhiều phòng).
  const roomOptionsQuery = useRoomOptionsQuery();
  const multiRoomActive = (roomOptionsQuery.data?.items.length ?? 0) > 1;
  const mySessionQuery = useMyRoomSessionQuery(multiRoomActive);
  const [changingRoom, setChangingRoom] = useState(false);

  const waiting = items.filter((i) => i.status === 'CHECKED_IN');
  const mine = waiting.filter((i) => i.doctorId === currentUser?.id);
  const pool = waiting.filter((i) => i.doctorId === null);
  const inConsultation = items.filter((i) => i.status === 'IN_CONSULTATION' && i.doctorId === currentUser?.id);
  const doneToday = items
    .filter((i) => i.status === 'COMPLETED' && i.doctorId === currentUser?.id)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  const poolDepartmentName = pool.length > 0 ? (departmentsQuery.data?.items.find((d) => d.id === pool[0]!.departmentId)?.name ?? null) : null;

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
      <div className="flex items-center gap-2">
        <h1 className="text-[17px] font-bold text-slate-900">Hàng đợi khám hôm nay</h1>
        {multiRoomActive && mySessionQuery.data && (
          <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            <MapPinLine size={13} weight="bold" aria-hidden="true" />
            Đang ở: {mySessionQuery.data.roomName}
            <button type="button" onClick={() => setChangingRoom(true)} className="font-semibold text-blue-600 hover:text-blue-700">
              Đổi phòng
            </button>
          </span>
        )}
      </div>

      {changingRoom && (
        <RoomSessionDialog
          options={roomOptionsQuery.data?.items ?? []}
          currentRoomId={mySessionQuery.data?.roomId}
          dismissible
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
          <QueueColumn title="Đang chờ" count={waiting.length} accent="border-t-blue-500">
            {waiting.length === 0 && <ColumnEmpty icon={ClipboardText} text="Chưa có bệnh nhân nào chờ khám." />}

            {mine.length > 0 && (
              <>
                <GroupLabel>Bệnh nhân của tôi</GroupLabel>
                {mine.map((item) => (
                  <WaitingCard key={item.encounterId} item={item} pool={false} loading={startConsultationMutation.isPending} onStart={() => void handleStart(item)} />
                ))}
              </>
            )}

            {pool.length > 0 && (
              <>
                <GroupLabel>Hàng chờ chung{poolDepartmentName ? ` · ${poolDepartmentName}` : ''}</GroupLabel>
                {pool.map((item) => (
                  <WaitingCard key={item.encounterId} item={item} pool loading={startConsultationMutation.isPending} onStart={() => void handleStart(item)} />
                ))}
              </>
            )}
          </QueueColumn>

          <QueueColumn title="Đang khám" count={inConsultation.length} accent="border-t-amber-500">
            {inConsultation.length === 0 && <ColumnEmpty icon={ClipboardText} text="Chỉ 1 bệnh nhân đang khám cùng lúc." />}
            {inConsultation.map((item) => (
              <div key={item.encounterId} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-900">{item.fullName}</div>
                    <div className="text-xs text-slate-500">
                      {item.patientCode} · Bắt đầu lúc {item.startedAt ? formatTime(item.startedAt) : '—'}
                    </div>
                  </div>
                </div>
                {item.chiefComplaint && <p className="mt-1.5 truncate text-xs text-slate-600">Lý do: {item.chiefComplaint}</p>}
                <Button type="button" variant="secondary" className="mt-2.5 w-full" onClick={() => navigate(`/encounters/${item.encounterId}`)}>
                  Tiếp tục khám
                  <ArrowRight size={13} weight="bold" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </QueueColumn>

          <QueueColumn title="Đã khám hôm nay" count={doneToday.length} accent="border-t-emerald-500">
            {doneToday.length === 0 && <ColumnEmpty icon={CheckCircle} text="Chưa có lượt khám nào hoàn tất trong ngày." />}
            {doneToday.map((item) => (
              <div key={item.encounterId} className="flex items-center justify-between gap-2 border-b border-slate-100 px-1 py-2 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{item.fullName}</div>
                  <div className="text-xs text-slate-400">{item.encounterNo}</div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/encounters/${item.encounterId}`)}
                  className="flex-shrink-0 text-xs font-semibold text-blue-600 hover:text-blue-700"
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

function QueueColumn({ title, count, accent, children }: { title: string; count: number; accent: string; children: React.ReactNode }) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-t-[3px] border-slate-200 bg-white shadow-sm ${accent}`}>
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-3.5 py-2.5">
        <span className="text-[11.5px] font-bold uppercase tracking-wide text-slate-800">{title}</span>
        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white">{count}</span>
      </div>
      <div className="scroll-hover flex-1 space-y-2 overflow-y-auto p-2.5">{children}</div>
    </section>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-0.5 pb-0.5 pt-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
      {children}
      <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
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
  return (
    <article
      className={`rounded-lg border-l-[3px] p-3 shadow-sm ${
        pool ? 'border-l-blue-400 border-y border-r border-dashed border-y-slate-200 border-r-slate-200 bg-white' : 'border border-slate-200 bg-white'
      } ${item.isPriority ? 'border-l-amber-500 bg-amber-50/30' : overdue && pool ? 'border-l-rose-500' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="truncate text-sm font-bold text-slate-900">{item.fullName}</span>
          <span className="ml-1.5 text-[11px] font-semibold text-slate-400">{item.patientCode}</span>
        </div>
        {item.isPriority && (
          <span className="flex-shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-700">Ưu tiên</span>
        )}
      </div>
      {item.chiefComplaint && <p className="mt-1 truncate text-xs text-slate-600">Lý do: {item.chiefComplaint}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${pool ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
          {pool ? 'Chưa gán bác sĩ' : 'Của tôi'}
        </span>
        <span>Tiếp nhận {formatTime(item.checkedInAt)}</span>
        <span className={`font-bold ${overdue ? 'text-rose-600' : 'text-slate-500'}`}>Chờ {minutes} phút</span>
      </div>
      <Button type="button" variant={pool ? 'secondary' : 'primary'} className="mt-2.5 w-full" loading={loading} onClick={onStart}>
        {pool ? <PlusCircle size={13} weight="bold" aria-hidden="true" /> : <Play size={13} weight="bold" aria-hidden="true" />}
        {pool ? 'Gọi khám — nhận ca này' : 'Bắt đầu khám'}
      </Button>
    </article>
  );
}