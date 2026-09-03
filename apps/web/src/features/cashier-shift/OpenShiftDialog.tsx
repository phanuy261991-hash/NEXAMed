import { useState } from 'react';
import { Calculator, Wallet, X } from '@phosphor-icons/react';
import type { CurrentCashierShiftResponse } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { DenominationCounter } from '../../shared/ui/DenominationCounter';
import { useOpenCashierShiftMutation } from './cashier-shift.queries';

/**
 * "Mở ca" — chủ động mở (nút "Mở ca" ở Thu ngân, hoặc tự bật khi bấm "Thu tiền" mà chưa có ca nào
 * đang mở). KHÔNG còn chặn toàn màn hình Thu ngân nữa (đảo hướng 2026-09-03, chủ dự án phản hồi
 * trực tiếp: chốt ca xong không có lý do gì bắt mở ca mới ngay — xem `docs/DECISIONS.md`) — chỉ
 * thao tác chạm tới tiền (Thu tiền/Chốt ca) mới cần ca đang mở. `onCancel` có thì hiện nút thoát
 * (dùng khi mở chủ động, không bắt buộc); `onSuccess` gọi sau khi mở ca thành công (ví dụ tự chạy
 * tiếp "Thu tiền" đang dang dở ở `InvoiceDetailPage.tsx`).
 */
export function OpenShiftDialog({
  previousClosedShift,
  onCancel,
  onSuccess,
}: {
  previousClosedShift: CurrentCashierShiftResponse['previousClosedShift'];
  onCancel?: () => void;
  onSuccess?: () => void;
}) {
  const suggested = previousClosedShift?.keepForNextAmount ?? 0;
  const [countedAmount, setCountedAmount] = useState<number>(suggested);
  const [showDenom, setShowDenom] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useOpenCashierShiftMutation();

  const diff = countedAmount - suggested;
  const hasDiff = previousClosedShift !== null && diff !== 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (hasDiff && !reason.trim()) {
      return;
    }
    try {
      await mutation.mutateAsync({ openingFloatActual: countedAmount, openingDiscrepancyReason: hasDiff ? reason : undefined });
      onSuccess?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không mở được ca, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="open-shift-title">
      <div className="w-full max-w-xl rounded-xl bg-white shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-100">
            <div>
              <h2 id="open-shift-title" className="text-lg font-bold text-slate-900">
                Mở ca làm việc
              </h2>
              <p className="mt-1 text-sm font-medium text-slate-500">Kiểm đếm tiền mặt trong két trước khi bắt đầu thu ngân.</p>
            </div>
            {onCancel && (
              <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700" aria-label="Đóng">
                <X size={20} weight="bold" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                  <Wallet size={20} weight="regular" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Vốn đầu ca</div>
                  <div className="text-xl font-bold text-slate-900">{formatVnd(suggested)}</div>
                  <div className="truncate text-xs font-medium text-slate-500">
                    {previousClosedShift
                      ? `${previousClosedShift.cashierName} bàn giao ${new Date(previousClosedShift.closedAt).toLocaleString('vi-VN')}`
                      : 'Ca đầu tiên — chưa có ca trước'}
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="open-count" className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Số tiền mặt đếm được <span className="text-rose-500">*</span>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <MoneyInput
                      id="open-count"
                      value={countedAmount}
                      onChange={(v) => setCountedAmount(v ?? 0)}
                      required
                      className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">đ</span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowDenom((v) => !v)}
                    aria-label="Máy tính mệnh giá"
                    title="Máy tính mệnh giá"
                    className="flex-shrink-0 px-3"
                  >
                    <Calculator size={18} weight="regular" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>

            {showDenom && <DenominationCounter value={countedAmount} onChange={setCountedAmount} />}

            {!hasDiff && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                {previousClosedShift ? 'Khớp với số ca trước để lại — sẵn sàng mở ca.' : 'Sẵn sàng mở ca.'}
              </div>
            )}

            {hasDiff && (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  Chênh lệch {diff > 0 ? '+' : '−'}
                  {formatVnd(Math.abs(diff))} so với vốn ca trước để lại.
                </div>
                <div>
                  <label htmlFor="open-reason" className="block text-sm font-semibold text-slate-800 mb-1.5">
                    Lý do chênh lệch <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    id="open-reason"
                    rows={2}
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Ví dụ: chủ phòng khám bổ sung quỹ đầu ngày, thiếu tiền lẻ từ ca trước..."
                    className="w-full rounded-md border border-amber-300 bg-white px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            )}

            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
          </div>

          <div className="px-6 pb-6 pt-2">
            <Button type="submit" className="w-full" loading={mutation.isPending} disabled={hasDiff && !reason.trim()}>
              Xác nhận mở ca
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
