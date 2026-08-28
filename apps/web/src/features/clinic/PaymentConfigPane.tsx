import { ApiError } from '../../shared/api/client';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useClinicSettingsQuery, useUpdateClinicSettingsMutation } from './clinic.queries';

/** Boxed Section Form Pattern — .claude/docs/ui-guidelines.md mục 9b. */
const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-4 pt-6';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

/**
 * "Cấu hình thanh toán" (Thu ngân cơ bản, Sprint 5/6) — pill riêng trong `/admin/system-config`
 * (yêu cầu chủ dự án trực tiếp, mockup Artifact đã duyệt). Bật/tắt tính năng "Thanh toán sau" CẤP
 * PHÒNG KHÁM (`tenant_setting.deferred_payment_enabled`, đọc/ghi qua `GET/PATCH /clinic-settings`
 * có sẵn từ S2-07 — không endpoint/permission mới). Tắt = mọi lượt khám bắt buộc thu tiền trước
 * khi vào Hàng đợi khám, checkbox "Thanh toán sau" tự ẩn khỏi form Tiếp nhận.
 */
export function PaymentConfigPane() {
  const settingsQuery = useClinicSettingsQuery();
  const updateMutation = useUpdateClinicSettingsMutation();

  const enabled = settingsQuery.data?.deferredPaymentEnabled ?? false;

  if (settingsQuery.isPending) {
    return <Skeleton className="h-28 w-full" />;
  }
  if (settingsQuery.isError) {
    return (
      <ErrorBanner
        message={settingsQuery.error instanceof ApiError ? settingsQuery.error.message : 'Không tải được cấu hình thanh toán.'}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  return (
    <div className={sectionBoxClassName}>
      <span className={sectionBadgeClassName}>Thanh toán sau</span>

      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="text-[14.5px] font-bold text-slate-900">Bật cho phép &quot;Thanh toán sau&quot;</p>
          <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-500">
            Bật để cho phép thực hiện dịch vụ trước khi thanh toán. Lễ tân có thể bỏ chọn để thu tiền ngay. Tắt để
            bắt buộc thanh toán trước khi thực hiện dịch vụ.
          </p>
        </div>
        <label className="relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={enabled}
            disabled={updateMutation.isPending}
            onChange={(e) => updateMutation.mutate({ deferredPaymentEnabled: e.target.checked })}
            aria-label='Bật cho phép "Thanh toán sau"'
          />
          <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-teal peer-disabled:opacity-60" />
          <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
        </label>
      </div>
    </div>
  );
}
