import { useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import type { EncounterSummary } from '@nexamed/shared';
import { useBillingInvoiceQuery } from '../../features/billing/invoice.queries';
import { useCancelEncounterMutation } from '../../features/reception/reception.queries';
import { ApiError } from '../api/client';
import { formatVnd } from '../format/currency';
import { Button } from './Button';

/**
 * "Hủy lượt khám" — dùng chung 4 nơi (`docs/DECISIONS.md` #085): Danh sách tiếp nhận,
 * Hàng đợi khám, Màn khám, Chi tiết phiếu thu. `CHECKED_IN` hoặc `IN_CONSULTATION → CANCELLED`,
 * bắt buộc lý do (.claude/docs/clinical-workflow.md).
 *
 * Tự tra phiếu thu qua `useBillingInvoiceQuery` để cảnh báo khi đã thu tiền — CHỦ ĐÍCH bỏ qua lỗi
 * (kể cả 403): bác sĩ/điều dưỡng không có `invoice.read` (xem ma trận mặc định ở
 * `packages/core/src/rbac/permissions.ts`) vẫn huỷ được ca bình thường, chỉ không thấy được số
 * tiền cụ thể đã thu — an toàn vẫn có ở màn `/billing` (badge "Cần hoàn tiền" cho lễ tân/admin xử
 * lý sau, xem `InvoiceListPage.tsx`/`InvoiceDetailPage.tsx`), không phụ thuộc dialog này thấy hay
 * không thấy cảnh báo.
 */
export function CancelEncounterDialog({
  encounterId,
  version,
  onCancelled,
  onClose,
}: {
  encounterId: string;
  version: number;
  onCancelled: (updated: EncounterSummary) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const invoiceQuery = useBillingInvoiceQuery(encounterId);
  const mutation = useCancelEncounterMutation();

  const invoicePaid = invoiceQuery.data?.status === 'PAID';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) {
      return;
    }
    try {
      const updated = await mutation.mutateAsync({ id: encounterId, body: { cancelReason: reason, version } });
      onCancelled(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không huỷ được lượt khám, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-encounter-title">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p id="cancel-encounter-title" className="text-sm font-semibold text-slate-900">
            Hủy lượt khám?
          </p>
          <p className="mt-1.5 text-xs text-slate-500">Lượt khám này sẽ chuyển sang trạng thái đã huỷ, không quay lại được.</p>

          {/* Nổi bật số tiền bằng huy hiệu tròn đặc + nền rất nhạt không viền — đúng khuôn
              "pendingCount" ở DoctorEndShiftDialog.tsx (docs/DECISIONS.md #095), không phải khung
              viền cảnh báo thuần chữ như bản cũ. */}
          {invoicePaid && (
            <div className="mt-3 flex items-center gap-3 rounded-md bg-amber-50/70 py-2.5 pl-2.5 pr-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-400 text-white">
                <Warning size={16} weight="fill" aria-hidden="true" />
              </div>
              <p className="text-xs leading-snug text-slate-700">
                Lượt khám này đã thu <span className="text-sm font-bold text-slate-900">{formatVnd(invoiceQuery.data!.totalAmount)}</span> — huỷ xong
                cần hoàn tiền riêng ở Thu ngân.
              </p>
            </div>
          )}

          <div className="mt-3.5">
            <label htmlFor="cancel-encounter-reason" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="cancel-encounter-reason"
              rows={2}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: khách chờ lâu, tự bỏ về"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" variant="danger" loading={mutation.isPending} disabled={!reason.trim()}>
              Xác nhận huỷ
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}