import { useEffect, useState } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import { Button } from '../../shared/ui/Button';
import { EditIconButton } from '../../shared/ui/EditIconButton';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useClinicSettingsQuery, useUpdateClinicSettingsMutation } from './clinic.queries';

/**
 * Khớp `DEFAULT_NO_SHOW_THRESHOLD_MINUTES` ở `@nexamed/shared` — khai riêng ở đây thay vì import
 * thẳng (hằng số giá trị thuần không export được qua `vite build`, cùng lỗi bundler #032/#091).
 */
const DEFAULT_NO_SHOW_THRESHOLD_MINUTES = 60;

const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-4 pt-6';
const sectionBadgeClassName =
  'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

/**
 * "Lịch hẹn" — mục con mới trong pill "Cấu hình phòng khám" (S5-07, APP-05, chủ dự án yêu cầu
 * trực tiếp). Tự động đánh dấu "Không đến": TẮT (mặc định) — lễ tân/bác sĩ tự bấm "Đánh dấu Không
 * đến" ở panel chi tiết lịch hẹn; BẬT — job nền (mỗi 5 phút) tự chuyển lịch `SCHEDULED` quá giờ
 * hẹn cộng ngưỡng cấu hình sang `NO_SHOW`. Bật/tắt lưu ngay (đúng khuôn `PaymentConfigPane.tsx`),
 * ngưỡng phút dùng edit/Lưu/Huỷ tường minh (đúng khuôn `ExamConfigPane.tsx`) — tránh lưu giá trị
 * dở dang lúc đang gõ số, và chỉ hiện/sửa được khi đã bật.
 */
export function AppointmentConfigPane() {
  const query = useClinicSettingsQuery();
  const mutation = useUpdateClinicSettingsMutation();

  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(String(DEFAULT_NO_SHOW_THRESHOLD_MINUTES));
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setMinutes(String(query.data.noShowThresholdMinutes));
  }, [query.data]);

  function handleToggleEnabled(enabled: boolean) {
    mutation.mutate({ noShowAutoEnabled: enabled });
  }

  function handleCancel() {
    setMinutes(String(query.data?.noShowThresholdMinutes ?? DEFAULT_NO_SHOW_THRESHOLD_MINUTES));
    setEditing(false);
  }

  function handleSave() {
    const parsed = Number(minutes);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) return;
    mutation.mutate(
      { noShowThresholdMinutes: parsed },
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
    return <Skeleton className="h-40 w-full" />;
  }
  if (query.isError) {
    return (
      <ErrorBanner
        message="Không tải được cấu hình lịch hẹn."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const enabled = query.data.noShowAutoEnabled;
  const invalid = editing && (!Number.isInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 1440);

  return (
    <div className="space-y-6">
      <div className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Tự động đánh dấu Không đến</span>
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-[14.5px] font-bold text-slate-900">Bật tự động đánh dấu &quot;Không đến&quot;</p>
            <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-500">
              Bật để hệ thống tự động cập nhật lịch hẹn quá giờ thành &quot;Không đến&quot;. Tắt để người dùng tự thao tác
              thủ công.
            </p>
          </div>
          <label className="relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={enabled}
              disabled={mutation.isPending}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
              aria-label='Bật tự động đánh dấu "Không đến"'
            />
            <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-teal peer-disabled:opacity-60" />
            <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </label>
        </div>

        <div className={`mt-3 flex items-center justify-between gap-5 border-t border-slate-100 pt-3 ${!enabled ? 'opacity-50' : ''}`}>
          <div>
            <p className="text-[14.5px] font-bold text-slate-900">Ngưỡng tính &quot;Không đến&quot;</p>
            <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-500">
              Lịch đã đặt quá giờ hẹn cộng thêm số phút cấu hình mà chưa tiếp nhận sẽ tự động chuyển thành &quot;Không
              đến&quot;. Tắt để người dùng tự thao tác thủ công.
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {editing ? (
              <>
                <input
                  id="no-show-threshold-minutes"
                  type="number"
                  min={1}
                  max={1440}
                  value={minutes}
                  disabled={!enabled}
                  onChange={(e) => setMinutes(e.target.value)}
                  className="w-20 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <span className="text-sm text-slate-500">phút</span>
              </>
            ) : (
              <span className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-base font-bold text-blue-700">
                {query.data.noShowThresholdMinutes} phút
              </span>
            )}
            {!editing && <EditIconButton disabled={!enabled} onClick={() => setEditing(true)} />}
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
      </div>

      {mutation.isError && <ErrorBanner message="Không lưu được cấu hình. Thử lại." />}

      {savedNotice && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          <CheckCircle size={15} weight="fill" aria-hidden="true" />
          Đã lưu cấu hình lịch hẹn.
        </div>
      )}
    </div>
  );
}
