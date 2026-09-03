import { useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { ArrowCounterClockwise, ArrowRight, ClipboardText, Clock, ClockCounterClockwise, MagnifyingGlass, User, UsersThree, X } from '@phosphor-icons/react';
import type { ReceptionListItem } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ReleaseEncounterDialog } from '../../shared/ui/ReleaseEncounterDialog';
import { Skeleton } from '../../shared/ui/Skeleton';
import { ApiError } from '../../shared/api/client';
import { useAuthStore } from '../auth/auth.store';
import { useScheduleConfigQuery } from '../appointment/appointment.queries';
import { getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { useDepartmentOptionsQuery } from '../department/department.queries';
import { ColumnEmpty, GroupLabel, WaitingCard, formatTime, matchesQueueSearch, waitMinutes } from './queue-card';
import { useReceptionListQuery, useStartConsultationMutation } from './reception.queries';

/** Fallback trước khi `useScheduleConfigQuery()` tải xong — cùng lý do khai riêng (không import
 * hằng số từ `@nexamed/shared`) đã ghi ở `ReceptionDoctorQueuePage.tsx` (Rollup không dò được
 * named export qua `__exportStar`, xem `docs/DECISIONS.md` #032/#087). */
const DEFAULT_OVERDUE_WAIT_WARNING_MINUTES = 30;

/**
 * Nút "Hàng chờ" ở Topbar (`TopBar.tsx`, trước cụm "Xin chào... + avatar") — cho bác sĩ theo dõi
 * khách đang chờ và chuyển sang khám ngay TẠI CHỖ mà không cần rời màn hình đang đứng (mockup đã
 * chốt cùng chủ dự án). **Chỉ mount khi đang ở màn hình khám (`/encounters/:id`) VÀ đúng vai trò
 * "Bác sĩ"** — điều kiện này do `TopBar.tsx` kiểm trước khi lazy-import component này, không lặp
 * lại kiểm tra ở đây.
 *
 * Dùng lại đúng dữ liệu/mutation của "Hàng đợi khám" (`ReceptionDoctorQueuePage.tsx`) — không tạo
 * API mới. Khác biệt duy nhất về hành vi nghiệp vụ: hệ thống KHÔNG giới hạn một bác sĩ chỉ được
 * `IN_CONSULTATION` đúng 1 lượt khám cùng lúc (`EncounterService.startConsultation()` không kiểm
 * tra điều này) — nên "Tiếp tục khám" một ca khác ở đây chỉ điều hướng sang, KHÔNG đóng/huỷ ca
 * đang xem dở; ca đó rơi xuống đúng nhóm "Đang khám dở" cho tới khi bác sĩ tự hoàn tất/trả về.
 */
export function DoctorQueueButton() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const encounterMatch = useMatch('/encounters/:id');
  const currentEncounterId = encounterMatch?.params.id;
  const today = getVietnamTodayDateString();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);
  // "Trả về hàng chờ" ngay trong panel — cho ca khác (không phải ca đang xem, xem `others` bên
  // dưới), theo yêu cầu chủ dự án (không cần quay ra "Hàng đợi khám" mới trả được).
  const [releasingItem, setReleasingItem] = useState<ReceptionListItem | null>(null);

  const listQuery = useReceptionListQuery(today, user?.id, true, true);
  const departmentsQuery = useDepartmentOptionsQuery(true);
  const scheduleConfigQuery = useScheduleConfigQuery();
  const startMutation = useStartConsultationMutation();

  const items = listQuery.data?.items ?? [];
  const warningMinutes = scheduleConfigQuery.data?.overdueWaitWarningMinutes ?? DEFAULT_OVERDUE_WAIT_WARNING_MINUTES;

  const waiting = items.filter((i) => i.status === 'CHECKED_IN');
  const mine = waiting.filter((i) => i.doctorId === user?.id);
  const pool = waiting.filter((i) => i.doctorId === null);
  // Loại trừ đúng lượt khám đang xem hiện tại (nếu có) — không tự liệt kê chính mình vào "đang khám dở".
  const others = items.filter((i) => i.status === 'IN_CONSULTATION' && i.doctorId === user?.id && i.encounterId !== currentEncounterId);

  const totalCount = mine.length + pool.length + others.length;
  const poolDepartmentName = pool.length > 0 ? (departmentsQuery.data?.items.find((d) => d.id === pool[0]!.departmentId)?.name ?? null) : null;

  const mineFiltered = mine.filter((i) => matchesQueueSearch(i, search));
  const poolFiltered = pool.filter((i) => matchesQueueSearch(i, search));
  const othersFiltered = others.filter((i) => matchesQueueSearch(i, search));

  function closeAndGoTo(encounterId: string) {
    setOpen(false);
    setSearch('');
    navigate(`/encounters/${encounterId}`);
  }

  async function handleStart(item: ReceptionListItem) {
    setRowError(null);
    try {
      await startMutation.mutateAsync({ id: item.encounterId, body: { version: item.version } });
      closeAndGoTo(item.encounterId);
    } catch (err) {
      // Lỗi tranh chấp "Nhận ca" (2 bác sĩ cùng bấm) — hiện inline, KHÔNG tự đóng panel để bác sĩ
      // thấy rõ vì sao rồi tự chọn ca khác, đúng mẫu `ReceptionDoctorQueuePage.handleStart()`.
      setRowError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="relative">
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} title="Hàng chờ khám">
        <UsersThree size={16} weight="bold" aria-hidden="true" />
        Hàng chờ
        {totalCount > 0 && (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white">
            {totalCount > 99 ? '99+' : totalCount}
          </span>
        )}
      </Button>

      {open && (
        <>
          {/* Backdrop + panel trượt (mục 2.2 ui-guidelines — Modal/Dialog: shadow-xl, z-50). */}
          <div className="fixed inset-0 z-40 bg-slate-900/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="Hàng chờ khám" className="fixed right-0 top-0 z-50 flex h-full w-[388px] flex-col border-l border-slate-200 bg-white shadow-xl">
            <div className="flex-shrink-0 border-b border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[14.5px] font-bold text-slate-900">
                  <UsersThree size={16} weight="bold" className="text-blue-600" aria-hidden="true" />
                  Hàng chờ khám
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Đóng"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X size={15} weight="bold" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-1 text-[11.5px] text-slate-500">Chọn một khách để chuyển sang khám ngay — không rời màn hình hiện tại.</p>
              <div className="relative mt-2.5">
                <MagnifyingGlass size={13} weight="bold" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm theo tên hoặc mã BN..."
                  className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-[13px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            {rowError && (
              <div className="flex-shrink-0 p-3 pb-0">
                <ErrorBanner message={rowError} />
              </div>
            )}

            <div className="scroll-hover flex-1 overflow-y-auto p-3">
              {listQuery.isPending && (
                <div className="space-y-2">
                  <Skeleton className="h-24 w-full rounded-lg" />
                  <Skeleton className="h-24 w-full rounded-lg" />
                </div>
              )}

              {listQuery.isError && (
                <ErrorBanner
                  message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được hàng chờ.'}
                  onRetry={() => void listQuery.refetch()}
                />
              )}

              {listQuery.isSuccess && (
                <div className="space-y-3">
                  {othersFiltered.length > 0 && (
                    <div className="space-y-2">
                      <GroupLabel icon={ClockCounterClockwise} variant="progress" count={others.length}>
                        Đang khám dở
                      </GroupLabel>
                      {othersFiltered.map((item) => (
                        <InProgressCard
                          key={item.encounterId}
                          item={item}
                          onContinue={() => closeAndGoTo(item.encounterId)}
                          onRelease={() => setReleasingItem(item)}
                        />
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <GroupLabel icon={User} variant="personal" count={mine.length}>
                      Bệnh nhân của tôi
                    </GroupLabel>
                    {mine.length === 0 && <ColumnEmpty icon={ClipboardText} text="Chưa có bệnh nhân nào chờ." />}
                    {mine.length > 0 && mineFiltered.length === 0 && <ColumnEmpty icon={MagnifyingGlass} text="Không tìm thấy bệnh nhân phù hợp." />}
                    {mineFiltered.map((item) => (
                      <WaitingCard key={item.encounterId} item={item} pool={false} loading={startMutation.isPending} warningMinutes={warningMinutes} onStart={() => void handleStart(item)} />
                    ))}
                  </div>

                  {pool.length > 0 && (
                    <div className="space-y-2">
                      <GroupLabel icon={UsersThree} variant="pool" count={pool.length}>
                        Hàng chờ chung{poolDepartmentName ? ` · ${poolDepartmentName}` : ''}
                      </GroupLabel>
                      {poolFiltered.length === 0 && <ColumnEmpty icon={MagnifyingGlass} text="Không tìm thấy bệnh nhân phù hợp." />}
                      {poolFiltered.map((item) => (
                        <WaitingCard key={item.encounterId} item={item} pool loading={startMutation.isPending} warningMinutes={warningMinutes} onStart={() => void handleStart(item)} />
                      ))}
                    </div>
                  )}

                  {totalCount === 0 && <ColumnEmpty icon={UsersThree} text="Không còn ai chờ — đã xử lý hết." />}
                </div>
              )}
            </div>

            <div className="flex flex-shrink-0 items-center border-t border-slate-200 px-4 py-2.5">
              <a
                href="/reception/doctor-queue"
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  navigate('/reception/doctor-queue');
                }}
                className="flex items-center gap-1 text-[11.5px] font-bold text-blue-600 hover:text-blue-700"
              >
                Xem đầy đủ Hàng đợi khám
                <ArrowRight size={11} weight="bold" aria-hidden="true" />
              </a>
            </div>
          </div>
        </>
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

/** Thẻ "đang khám dở" (ca khác của chính bác sĩ này) — "Tiếp tục khám" + "Trả về hàng chờ" (không
 * cần quay ra "Hàng đợi khám" mới trả được, yêu cầu chủ dự án). Không có "Hủy khám" ở đây — hành
 * động đóng ca hẳn vẫn chỉ làm ở trang Hàng đợi khám đầy đủ hoặc ngay tại màn khám của ca đó. */
function InProgressCard({ item, onContinue, onRelease }: { item: ReceptionListItem; onContinue: () => void; onRelease: () => void }) {
  return (
    <article className="rounded-lg border-2 border-l-4 border-slate-200 border-l-amber-500 bg-amber-50/50 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 truncate">
          <span className="text-[15px] font-bold text-slate-900">{item.fullName}</span>
          <span className="ml-1.5 text-[11px] font-bold text-slate-500">{item.patientCode}</span>
        </div>
        {item.startedAt && (
          <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-500 px-2 py-1 text-[11px] font-bold text-white">
            <Clock size={11} weight="bold" aria-hidden="true" />
            {waitMinutes(item.startedAt)} phút
          </span>
        )}
      </div>
      {item.chiefComplaint && (
        <p className="mt-1 truncate text-[12.5px] text-slate-700">
          <span className="font-bold text-slate-900">Lý do: </span>
          {item.chiefComplaint}
        </p>
      )}
      {item.startedAt && <p className="mt-1 text-[11px] font-semibold text-slate-500">Bắt đầu lúc {formatTime(item.startedAt)}</p>}
      <div className="mt-2.5 flex items-center gap-1.5">
        <Button type="button" variant="amber" className="flex-1" onClick={onContinue}>
          Tiếp tục khám
          <ArrowRight size={13} weight="bold" aria-hidden="true" />
        </Button>
        <Button type="button" variant="secondary" className="flex-shrink-0 px-2.5" onClick={onRelease} aria-label="Trả về hàng chờ" title="Trả về hàng chờ">
          <ArrowCounterClockwise size={15} weight="bold" aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}