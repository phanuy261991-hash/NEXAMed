import { ApiError } from '../../shared/api/client';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useClinicSettingsQuery, useUpdateClinicSettingsMutation } from './clinic.queries';

/** Boxed Section Form Pattern — .claude/docs/ui-guidelines.md mục 9b. */
const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-4 pt-6';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

/**
 * "Cấu hình chung" — mục con mới trong pill "Cấu hình phòng khám", dưới "Ca làm việc" (chủ dự án
 * yêu cầu trực tiếp, 02/09/2026, tiếp sau `docs/DECISIONS.md` #104). Chỉ 1 công tắc ở v1: bật/tắt
 * cho phép nhân viên tự đăng ký ca trên "Lịch làm việc của tôi" (`tenant_setting.
 * allow_staff_self_schedule_enabled`, đọc/ghi qua `GET/PATCH /clinic-settings` có sẵn — không
 * endpoint/permission mới). Tắt thì `MyWorkSchedulePage.tsx` tự ẩn hết nút tự đăng ký/xoá/chọn
 * nhiều ngày/sao chép, chỉ còn xem lịch đã được phân công (read-only) — không ảnh hưởng "Lịch làm
 * việc nhân viên" (scope `global`, `clinic_admin` vẫn tạo/sửa/xoá hộ bình thường). Cùng khuôn
 * `PaymentConfigPane.tsx` (pill phẳng, 1 công tắc, auto-save tức thời).
 */
export function GeneralConfigPane() {
  const settingsQuery = useClinicSettingsQuery();
  const updateMutation = useUpdateClinicSettingsMutation();

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
    </div>
  );
}
