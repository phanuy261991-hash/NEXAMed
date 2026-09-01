import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { CaretRight, Clock, GearSix, House, IdentificationBadge, Pause, Play, SignOut, WarningCircle } from '@phosphor-icons/react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import { logout } from '../../features/auth/auth.api';
import { useAuthStore } from '../../features/auth/auth.store';
import { useDoctorAvailabilityPolicyQuery, useDoctorAvailabilityTodayQuery, useSetDoctorAvailabilityMutation } from '../../features/clinic/clinic.queries';
import { useClosingTimeReminder } from '../../features/clinic/useClosingTimeReminder';
import { getInitials } from '../format/initials';
import { formatClockTime } from '../format/time';
import { useBreadcrumbItems } from './breadcrumb.context';

/**
 * Lazy-load — dù chỉ hiện đúng ở màn hình khám (`/encounters/:id`), `TopBar` vẫn render trên MỌI
 * trang (không tự lazy như route ở `router.tsx`), nên phải tự lazy import `DoctorQueueButton`
 * (kéo theo toàn bộ phụ thuộc module `reception` — queries/API/queue-card...) để không đẩy các
 * phụ thuộc đó vào chunk khởi động. Đã đo thật: main chunk tăng từ 448.98 kB lên 499.58 kB nếu
 * import tĩnh, vi phạm ngưỡng ≤500 kB đã chốt (`.claude/docs/coding-standards.md` mục "Hiệu suất",
 * #073).
 */
const DoctorQueueButton = lazy(() =>
  import('../../features/reception/DoctorQueueButton').then((m) => ({ default: m.DoctorQueueButton })),
);

/**
 * "Tạm nghỉ / Đóng ca" — cùng lý do lazy `DoctorQueueButton` ở trên: 2 dialog này kéo theo
 * `useReceptionListQuery` (đếm "N lượt khám chưa xử lý") → toàn bộ phụ thuộc module `reception`.
 * Đo thật: main chunk 452.75 → 477.79 kB nếu import tĩnh — lazy để giữ đúng baseline.
 */
const DoctorBreakDialog = lazy(() => import('../ui/DoctorBreakDialog').then((m) => ({ default: m.DoctorBreakDialog })));
const DoctorEndShiftDialog = lazy(() => import('../ui/DoctorEndShiftDialog').then((m) => ({ default: m.DoctorEndShiftDialog })));

/**
 * "Thông tin tài khoản" (menu avatar) — kéo theo query Khoa/Phòng + 3 danh mục tham chiếu (Học
 * hàm, Chức danh, Trạng thái làm việc) chỉ dùng ở popup này, không cần cho mọi trang — lazy cùng
 * lý do các dialog phía trên.
 */
const MyAccountDialog = lazy(() => import('../../features/user-account/MyAccountDialog').then((m) => ({ default: m.MyAccountDialog })));

/**
 * Thanh trên cùng — thay thế user card ở chân sidebar (S1-08) và nút "← Quay lại" trên trang con
 * (.claude/docs/ui-guidelines.md mục 8.2, docs/DECISIONS.md #027). Trái: breadcrumb phân cấp.
 * Phải: lời chào + avatar mở dropdown CHỈ có "Đăng xuất". "Tạm nghỉ / Đóng ca" tách hẳn sang nút
 * bánh răng riêng cạnh avatar (mockup chốt trực tiếp, chưa ghi số quyết định) — chỉ hiện với vai
 * trò Bác sĩ VÀ đang ở 1 trong 2 màn hình có ý nghĩa với ca trực (Hàng đợi khám/Màn hình khám),
 * mang theo cả chấm trạng thái BREAK/ENDED (trước đây gắn trên avatar). Không có chuông thông báo
 * (v1 chưa có hệ thống thông báo trong ứng dụng) và không hiện tên khoa (`/auth/me` chưa trả
 * trường này) — cả hai đã hỏi và chốt bỏ.
 */
export function TopBar() {
  const items = useBreadcrumbItems();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();
  // "Hàng chờ" CHỈ hiện ở màn hình khám (`/encounters/:id`), CHỈ vai trò "Bác sĩ" (không cả
  // `clinic_admin`) — theo yêu cầu chủ dự án, không phải mọi trang/mọi vai trò quản lý được.
  const isOnEncounterPage = useMatch('/encounters/:id') !== null;
  const isOnDoctorQueuePage = useMatch('/reception/doctor-queue') !== null;
  const isDoctor = user?.roles.includes('doctor') ?? false;
  // Bánh răng "Ca trực" (Tạm nghỉ/Đóng ca) chỉ có ý nghĩa ở 2 màn hình bác sĩ thực sự làm việc với
  // hàng đợi/bệnh nhân — mockup chốt trực tiếp với chủ dự án, không hiện ở mọi trang khác (khác 3
  // badge trạng thái bên dưới, vẫn hiện toàn app, không đổi).
  const showAvailabilityGear = isDoctor && (isOnEncounterPage || isOnDoctorQueuePage);

  const [gearMenuOpen, setGearMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const gearRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const [endShiftDialog, setEndShiftDialog] = useState<{ trigger?: 'SCHEDULED_END' } | null>(null);
  const [breakDialogOpen, setBreakDialogOpen] = useState(false);
  const [myAccountOpen, setMyAccountOpen] = useState(false);

  // "Tạm nghỉ / Đóng ca" — board trả CHỈ bác sĩ BREAK/ENDED hôm nay, không có dòng = ACTIVE ngầm định.
  const availabilityQuery = useDoctorAvailabilityTodayQuery(isDoctor);
  const policyQuery = useDoctorAvailabilityPolicyQuery();
  const setAvailability = useSetDoctorAvailabilityMutation();
  const myAvailability = availabilityQuery.data?.items.find((i) => i.doctorId === user?.id);
  const status = myAvailability?.status ?? 'ACTIVE';
  const isEnded = status === 'ENDED';
  const isBreak = status === 'BREAK';
  // Mặc định true (khớp DEFAULT_ALLOW_EMERGENCY_END_SHIFT) lúc chưa tải xong — tránh nhấp nháy ẩn/hiện.
  const allowEmergencyEndShift = policyQuery.data?.allowEmergencyEndShift ?? true;

  // Trường hợp 2 "Hết giờ làm việc" — chỉ theo dõi khi đang ACTIVE/BREAK (đã ENDED thì hết cần nhắc).
  const pastClosingTime = useClosingTimeReminder(isDoctor && !isEnded);

  useEffect(() => {
    if (pastClosingTime && !isEnded) {
      setEndShiftDialog({ trigger: 'SCHEDULED_END' });
    }
  }, [pastClosingTime, isEnded]);

  useEffect(() => {
    if (!gearMenuOpen && !accountMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (gearRef.current && !gearRef.current.contains(e.target as Node)) setGearMenuOpen(false);
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [gearMenuOpen, accountMenuOpen]);

  async function handleLogout() {
    setAccountMenuOpen(false);
    try {
      await logout();
    } finally {
      clear();
      navigate('/login', { replace: true });
    }
  }

  function handleResume() {
    setGearMenuOpen(false);
    void setAvailability.mutateAsync({ doctorId: user!.id, body: { status: 'ACTIVE' } });
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
        <Link
          to="/"
          aria-label="Về Tổng quan"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <House size={15} weight="regular" aria-hidden="true" />
        </Link>

        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <span key={`${item.label}-${index}`} className="flex items-center gap-1">
              <CaretRight size={11} weight="bold" className="text-slate-300" aria-hidden="true" />
              {!isLast && item.to ? (
                <Link
                  to={item.to}
                  className="rounded-md px-2 py-1 font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={
                    isLast
                      ? 'rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-700'
                      : 'rounded-md px-2 py-1 font-medium text-slate-500'
                  }
                >
                  {item.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <div className="flex items-center gap-3">
        {isOnEncounterPage && isDoctor && (
          <Suspense fallback={null}>
            <DoctorQueueButton />
          </Suspense>
        )}

        {isDoctor && pastClosingTime && !isEnded && (
          <button
            type="button"
            onClick={() => setEndShiftDialog({ trigger: 'SCHEDULED_END' })}
            className="flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
          >
            <Clock size={12} weight="fill" aria-hidden="true" />
            Đã quá giờ làm việc — Đóng ca
          </button>
        )}

        {isDoctor && isBreak && myAvailability && (
          <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
            Đang tạm nghỉ {formatClockTime(myAvailability.statusChangedAt)}
          </span>
        )}
        {isDoctor && isEnded && myAvailability && (
          <span className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
            Đã đóng ca {formatClockTime(myAvailability.statusChangedAt)}
          </span>
        )}

        <span className="text-sm text-slate-500">
          Xin chào, <strong className="font-semibold text-slate-900">{user.displayName ?? user.fullName}</strong>
        </span>

        {showAvailabilityGear && (
          <div className="relative" ref={gearRef}>
            <button
              type="button"
              onClick={() => {
                setGearMenuOpen((v) => !v);
                setAccountMenuOpen(false);
              }}
              aria-haspopup="menu"
              aria-expanded={gearMenuOpen}
              aria-label="Menu ca trực"
              title="Ca trực"
              className="relative flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
            >
              <GearSix size={18} weight="regular" aria-hidden="true" />
              {(isBreak || isEnded) && (
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${isBreak ? 'bg-amber-500' : 'bg-slate-400'}`}
                  aria-hidden="true"
                />
              )}
            </button>

            {gearMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-11 z-30 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-md"
              >
                {isBreak ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleResume}
                    className="flex w-full items-center gap-2 px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Play size={16} weight="regular" aria-hidden="true" />
                    Quay lại làm việc
                  </button>
                ) : isEnded ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleResume}
                    className="flex w-full items-center gap-2 px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Play size={16} weight="regular" aria-hidden="true" />
                    Mở lại ca làm việc
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setGearMenuOpen(false);
                        setBreakDialogOpen(true);
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
                    >
                      <Pause size={16} weight="regular" aria-hidden="true" />
                      Tạm nghỉ
                    </button>
                    {allowEmergencyEndShift && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setGearMenuOpen(false);
                          setEndShiftDialog({});
                        }}
                        className="flex w-full items-center gap-2 px-2.5 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
                      >
                        <WarningCircle size={16} weight="regular" aria-hidden="true" />
                        Đóng ca hôm nay
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="relative" ref={accountRef}>
          <button
            type="button"
            onClick={() => {
              setAccountMenuOpen((v) => !v);
              setGearMenuOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            aria-label="Menu tài khoản"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-blue-50 text-xs font-bold text-blue-600 hover:bg-blue-100"
          >
            {getInitials(user.displayName ?? user.fullName)}
          </button>

          {accountMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-11 z-30 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-md"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountMenuOpen(false);
                  setMyAccountOpen(true);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <IdentificationBadge size={16} weight="regular" aria-hidden="true" />
                Thông tin tài khoản
              </button>
              <div className="my-1 h-px bg-slate-200" />
              <button
                type="button"
                role="menuitem"
                onClick={() => void handleLogout()}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <SignOut size={16} weight="regular" aria-hidden="true" />
                Đăng xuất
              </button>
            </div>
          )}
        </div>
      </div>

      <Suspense fallback={null}>
        {myAccountOpen && <MyAccountDialog onClose={() => setMyAccountOpen(false)} />}
        {breakDialogOpen && user && (
          <DoctorBreakDialog doctorId={user.id} onDone={() => setBreakDialogOpen(false)} onClose={() => setBreakDialogOpen(false)} />
        )}
        {endShiftDialog && user && (
          <DoctorEndShiftDialog
            doctorId={user.id}
            trigger={endShiftDialog.trigger}
            onDone={() => setEndShiftDialog(null)}
            onClose={() => setEndShiftDialog(null)}
          />
        )}
      </Suspense>
    </div>
  );
}
