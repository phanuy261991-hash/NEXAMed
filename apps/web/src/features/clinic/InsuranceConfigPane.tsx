import { CheckCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useClinicSettingsQuery, useUpdateClinicSettingsMutation } from './clinic.queries';

/** Boxed Section Form Pattern — .claude/docs/ui-guidelines.md mục 9b (cùng khuôn `ExamConfigPane`/`GeneralConfigPane`). */
const sectionBoxClassName = 'relative rounded-lg border border-slate-200 p-4 pt-6';
const sectionBadgeClassName = 'absolute -top-3 left-4 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white';

const WHEN_ON = [
  'Khung thẻ ở hồ sơ bệnh nhân, chọn thẻ ở Tiếp nhận',
  'Nhãn BHYT ở Hàng đợi, màn Khám, Lịch sử khám',
  'Tìm bệnh nhân theo số thẻ, ba ô tích in',
  'Liên thông đơn thuốc gửi thẻ 12 số',
];
const WHEN_OFF = ['Ẩn toàn bộ các mục trên, giao diện như hiện nay', 'Lượt khám mới ghi tự chi trả', 'Không thêm, sửa thẻ được', 'Thẻ đã nhập vẫn giữ, hiện lại khi bật'];

/**
 * "Thẻ BHYT" — mục con của pill "Cấu hình phòng khám" (S2-04, docs/DECISIONS.md #243, mockup https://claude.ai/artifact/FAi8GCjycj94s6EwTT9t6b màn 5).
 * Công tắc TỔNG "Phòng khám áp dụng BHYT": chung cả công ty, mặc định TẮT (nhiều phòng khám không dùng BHYT). Lưu tức thì như các công tắc khác ở "Cấu hình khám".
 * Công tắc dùng khuôn trượt sẵn có của app (teal) thay cho màu xanh dương của mockup để đồng nhất với mọi công tắc cấu hình khác.
 */
export function InsuranceConfigPane() {
  const query = useClinicSettingsQuery();
  const mutation = useUpdateClinicSettingsMutation();
  const [savedNotice, setSavedNotice] = useState(false);

  if (query.isPending) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (query.isError) {
    return (
      <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Không tải được cấu hình.'} onRetry={() => void query.refetch()} />
    );
  }

  const enabled = query.data.insuranceEnabled;

  function handleToggle(next: boolean) {
    setSavedNotice(false);
    mutation.mutate(
      { insuranceEnabled: next },
      {
        onSuccess: () => {
          setSavedNotice(true);
          window.setTimeout(() => setSavedNotice(false), 2000);
        },
      },
    );
  }

  return (
    <div>
      <h2 className="sr-only">Thẻ BHYT</h2>
      <div className={sectionBoxClassName}>
        <span className={sectionBadgeClassName}>Thẻ BHYT</span>

        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="text-[14.5px] font-semibold text-slate-900">Phòng khám áp dụng BHYT</p>
              <StatusBadge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Đang bật' : 'Đang tắt'}</StatusBadge>
            </div>
            <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-500">
              Áp dụng cho cả công ty. Bật khi phòng khám có nhận khách đi khám bằng thẻ bảo hiểm y tế. Chỉ lưu và hiển thị thẻ, hệ thống không tính chi trả.
            </p>
          </div>
          <label className="relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={enabled}
              disabled={mutation.isPending}
              onChange={(e) => handleToggle(e.target.checked)}
              aria-label="Phòng khám áp dụng BHYT"
            />
            <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand-teal peer-disabled:opacity-60" />
            <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </label>
        </div>

        <div className="mt-4 grid gap-x-8 gap-y-3 border-t border-slate-100 pt-4 text-[13px] text-slate-600 sm:grid-cols-2">
          <div>
            <p className="font-semibold text-slate-800">Khi bật</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {WHEN_ON.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Khi tắt</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {WHEN_OFF.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {mutation.isError && (
        <div className="mt-4">
          <ErrorBanner message={mutation.error instanceof ApiError ? mutation.error.message : 'Không lưu được cấu hình.'} />
        </div>
      )}
      {savedNotice && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          <CheckCircle size={15} weight="fill" aria-hidden="true" />
          Đã lưu cấu hình thẻ BHYT.
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Ba ô tích in số thẻ (Đơn thuốc, Phiếu thu, Bệnh án PDF) nằm ở Quản lý mẫu in của từng chứng từ.</p>
    </div>
  );
}
