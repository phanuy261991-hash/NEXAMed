import { useEffect, useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { EditIconButton } from '../../shared/ui/EditIconButton';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useClinicSettingsQuery, useUpdateClinicSettingsMutation } from './clinic.queries';

/** Boxed Section Form Pattern — .claude/docs/ui-guidelines.md mục 9b. */
const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-4 pt-6';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

/** Fallback trước khi query tải xong — khớp `DEFAULT_WORK_SHIFT_ASSIGNMENT_LOCK_GRACE_DAYS` ở
 * `@nexamed/shared`, khai riêng ở đây thay vì import thẳng (hằng số giá trị thuần từ
 * `packages/shared` không export được qua `vite build` — cùng lỗi bundler #032/`ExamConfigPane.tsx`). */
const DEFAULT_WORK_SHIFT_ASSIGNMENT_LOCK_GRACE_DAYS = 0;

/**
 * "Cấu hình chung" — mục con trong pill "Cấu hình phòng khám", dưới "Ca làm việc" (chủ dự án yêu
 * cầu trực tiếp, 02/09/2026, tiếp sau `docs/DECISIONS.md` #104). Khối 1: bật/tắt cho phép nhân viên
 * tự đăng ký ca trên "Lịch làm việc của tôi" (`tenant_setting.allow_staff_self_schedule_enabled`,
 * đọc/ghi qua `GET/PATCH /clinic-settings` có sẵn) — tắt thì `MyWorkSchedulePage.tsx` tự ẩn hết nút
 * tự đăng ký/xoá/chọn nhiều ngày/sao chép, chỉ còn xem lịch đã được phân công (read-only), không
 * ảnh hưởng "Lịch làm việc nhân viên" (scope `global`, `clinic_admin` vẫn tạo/sửa/xoá hộ bình
 * thường).
 *
 * Khối 2 (2026-09-03, "Khoá bảng ca" theo tháng, ngoài kế hoạch — chuẩn bị nền cho chấm công/tính
 * lương v2, chưa xây): số ngày ân hạn SAU khi sang tháng mới trước khi tháng trước bị khoá TOÀN BỘ
 * (Thêm/Sửa/Xoá) cho MỌI actor kể cả `clinic_admin`, trừ ai có quyền `work_shift_assignment.unlock`
 * (đặc quyền mở rộng, cấu hình qua "Vai trò & Phân quyền" — mặc định `clinic_admin`/`system_admin`).
 * Dùng Edit/Lưu/Huỷ tường minh (đúng khuôn `ExamConfigPane.tsx`) thay vì auto-save tức thời — tránh
 * lưu giá trị dở dang lúc đang gõ số.
 */
export function GeneralConfigPane() {
  const settingsQuery = useClinicSettingsQuery();
  const updateMutation = useUpdateClinicSettingsMutation();

  const [editingGraceDays, setEditingGraceDays] = useState(false);
  const [graceDays, setGraceDays] = useState(String(DEFAULT_WORK_SHIFT_ASSIGNMENT_LOCK_GRACE_DAYS));

  useEffect(() => {
    if (!settingsQuery.data) return;
    setGraceDays(String(settingsQuery.data.workShiftAssignmentLockGraceDays));
  }, [settingsQuery.data]);

  const enabled = settingsQuery.data?.allowStaffSelfScheduleEnabled ?? true;

  if (settingsQuery.isPending) {
    return <Skeleton className="h-28 w-full" />;
  }
  if (settingsQuery.isError) {
    return (
      <ErrorBanner
        message={settingsQuery.error instanceof ApiError ? settingsQuery.error.message : 'Không tải được cấu hình chung.'}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  function handleCancelGraceDays() {
    setGraceDays(String(settingsQuery.data?.workShiftAssignmentLockGraceDays ?? DEFAULT_WORK_SHIFT_ASSIGNMENT_LOCK_GRACE_DAYS));
    setEditingGraceDays(false);
  }

  function handleSaveGraceDays() {
    const parsed = Number(graceDays);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 27) return;
    updateMutation.mutate(
      { workShiftAssignmentLockGraceDays: parsed },
      { onSuccess: () => setEditingGraceDays(false) },
    );
  }

  const graceDaysInvalid = editingGraceDays && (!Number.isInteger(Number(graceDays)) || Number(graceDays) < 0 || Number(graceDays) > 27);

  return (
    <div className={sectionBoxClassName}>
      <span className={sectionBadgeClassName}>Lịch làm việc</span>

      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="text-[14.5px] font-bold text-slate-900">Cho phép nhân viên tự đăng ký ca</p>
          <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-500">
            Bật (mặc định): nhân viên tự đăng ký/xoá ca của mình trên &quot;Lịch làm việc của tôi&quot;. Tắt: ẩn hết
            thao tác tự đăng ký, trang chỉ còn xem lịch đã được phân công từ &quot;Lịch làm việc nhân viên&quot;.
          </p>
        </div>
        <label className="relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={enabled}
            disabled={updateMutation.isPending}
            onChange={(e) => updateMutation.mutate({ allowStaffSelfScheduleEnabled: e.target.checked })}
            aria-label="Cho phép nhân viên tự đăng ký ca"
          />
          <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-teal peer-disabled:opacity-60" />
          <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
        </label>
      </div>

      <div className="mt-4 flex items-start justify-between gap-5 border-t border-slate-100 pt-4">
        <div>
          <p className="text-[14.5px] font-bold text-slate-900">Số ngày được phép chỉnh sửa lịch của tháng trước</p>
          <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-500">
            Cho phép chỉnh sửa lịch làm việc của tháng trước trong số ngày đầu tháng. Hết thời hạn, lịch sẽ tự động
            khoá và chỉ người có quyền &quot;Sửa lịch đã khoá&quot; mới được chỉnh sửa.
            <br />
            <strong>0</strong> = khoá ngay khi sang tháng mới.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {editingGraceDays ? (
            <>
              <input
                id="work-shift-assignment-lock-grace-days"
                type="number"
                min={0}
                max={27}
                value={graceDays}
                onChange={(e) => setGraceDays(e.target.value)}
                className="w-16 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="text-sm text-slate-500">ngày</span>
              <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={handleCancelGraceDays} disabled={updateMutation.isPending}>
                Huỷ
              </Button>
              <Button
                type="button"
                className="px-3 py-1.5 text-xs"
                loading={updateMutation.isPending}
                disabled={graceDaysInvalid}
                onClick={handleSaveGraceDays}
              >
                Lưu
              </Button>
            </>
          ) : (
            <>
              <span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-base font-bold text-blue-700">
                {settingsQuery.data.workShiftAssignmentLockGraceDays} ngày
              </span>
              <EditIconButton onClick={() => setEditingGraceDays(true)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
