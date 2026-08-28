import { useEffect, useState } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useClinicSettingsQuery, useUpdateClinicSettingsMutation } from './clinic.queries';

/**
 * Fallback trước khi `useClinicSettingsQuery()` tải xong — khớp `DEFAULT_OVERDUE_WAIT_WARNING_MINUTES`
 * ở `@nexamed/shared`, khai riêng ở đây thay vì import thẳng (hằng số giá trị thuần từ
 * `packages/shared` không export được qua `vite build` — cùng lỗi bundler đã gặp ở
 * `ReceptionDoctorQueuePage.tsx`/`docs/DECISIONS.md` #032).
 */
const DEFAULT_OVERDUE_WAIT_WARNING_MINUTES = 30;

const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-4 pt-6';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

/**
 * "Cấu hình khám" — pill mới ở `/admin/system-config` (2026-08-28, chủ dự án yêu cầu trực tiếp).
 * Chỉ 1 cấu hình ở v1: ngưỡng "chờ lâu" ở Hàng đợi khám (`ReceptionDoctorQueuePage.tsx`) — trước
 * đây hardcode `WAIT_WARNING_MINUTES=30`, nay đọc/ghi qua `GET/PATCH /clinic-settings` có sẵn từ
 * S2-07 (field `overdueWaitWarningMinutes` mới, không endpoint/permission mới). Cùng khuôn
 * `PaymentConfigPane.tsx` (pill phẳng, 1 cấu hình) nhưng dùng edit/Lưu/Huỷ tường minh thay vì
 * auto-save tức thời — tránh lưu giá trị dở dang lúc đang gõ số.
 */
export function ExamConfigPane() {
  const query = useClinicSettingsQuery();
  const mutation = useUpdateClinicSettingsMutation();

  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(String(DEFAULT_OVERDUE_WAIT_WARNING_MINUTES));
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setMinutes(String(query.data.overdueWaitWarningMinutes));
  }, [query.data]);

  function handleCancel() {
    setMinutes(String(query.data?.overdueWaitWarningMinutes ?? DEFAULT_OVERDUE_WAIT_WARNING_MINUTES));
    setEditing(false);
  }

  function handleSave() {
    const parsed = Number(minutes);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 240) return;
    mutation.mutate(
      { overdueWaitWarningMinutes: parsed },
      {
        onSuccess: () => {
          setEditing(false);
          setSavedNotice(true);
          setTimeout(() => setSavedNotice(false), 3000);
        },
      },
    );
  }

  if (query.isPending) {
    return <Skeleton className="h-28 w-full" />;
  }
  if (query.isError) {
    return (
      <ErrorBanner
        message="Không tải được cấu hình khám."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const invalid = editing && (!Number.isInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 240);

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">Áp dụng cho cảnh báo &quot;chờ lâu&quot; ở Hàng đợi khám.</p>
        {!editing && (
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Sửa
          </Button>
        )}
      </div>

      <div className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Cảnh báo chờ lâu</span>

        <div className="flex items-center justify-between gap-5">
          <div>
            <p className="text-[14.5px] font-bold text-slate-900">Ngưỡng thời gian tính &quot;chờ lâu&quot;</p>
            <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-500">
              Khách chờ khám vượt quá số phút quy định, tính từ thời điểm tiếp nhận, sẽ được đánh dấu &quot;Chờ
              lâu&quot; trong Hàng đợi khám để bác sĩ ưu tiên xử lý.
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {editing ? (
              <>
                <input
                  id="overdue-wait-warning-minutes"
                  type="number"
                  min={1}
                  max={240}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className="w-20 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <span className="text-sm text-slate-500">phút</span>
              </>
            ) : (
              <span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-base font-bold text-blue-700">
                {query.data.overdueWaitWarningMinutes} phút
              </span>
            )}
          </div>
        </div>

        {editing && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleCancel} disabled={mutation.isPending}>
              Huỷ
            </Button>
            <Button type="button" loading={mutation.isPending} disabled={invalid} onClick={handleSave}>
              Lưu
            </Button>
          </div>
        )}

        {mutation.isError && <ErrorBanner message="Không lưu được cấu hình. Thử lại." />}
      </div>

      {savedNotice && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          <CheckCircle size={15} weight="fill" aria-hidden="true" />
          Đã lưu cấu hình khám.
        </div>
      )}
    </div>
  );
}