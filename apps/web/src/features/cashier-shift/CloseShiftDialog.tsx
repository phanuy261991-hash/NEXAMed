import { useState } from 'react';
import { Bank, Check, CreditCard, Vault, Wallet, X } from '@phosphor-icons/react';
import type { CashierShiftDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { DenominationCounter } from '../../shared/ui/DenominationCounter';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useHasPermission } from '../auth/usePermission';
import { CashVoucherFormDialog, type CashVoucherSubmitDto } from '../cash-book/CashVoucherFormDialog';
import { useCreateCashVoucherMutation } from '../cash-book/cash-voucher.queries';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { CashierShiftReceiptView } from './CashierShiftReceiptView';
import { useCashierShiftBlindCloseEnabledQuery, useCashierShiftSummaryQuery, useCloseCashierShiftMutation } from './cashier-shift.queries';

const STEP_LABELS = ['Tổng kết hệ thống', 'Kiểm đếm tiền mặt', 'Đối soát', 'Bàn giao'];

/** "Chốt ca" — wizard 4 bước, dùng số bước vì đây là luồng thật sự tuần tự (`.claude/docs/ui-guidelines.md` mục 8.2). */
export function CloseShiftDialog({ shift, onClose }: { shift: CashierShiftDetail; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [countedAmount, setCountedAmount] = useState(0);
  const [directEntry, setDirectEntry] = useState(false);
  const [discrepancyReason, setDiscrepancyReason] = useState('');
  const [keepAmount, setKeepAmount] = useState<number>(shift.openingFloatActual);
  const [handoverNote, setHandoverNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [closedShift, setClosedShift] = useState<CashierShiftDetail | null>(null);
  // "Sổ quỹ & Thu chi" GĐ1 — nút tắt lập phiếu thu/chi ngay trong bước đếm tiền (yêu cầu #5 mockup):
  // lập xong tự invalidate `cashier-shift` (xem cash-voucher.queries.ts) nên "Tiền mặt dự kiến" ở
  // Bước 1/3 cập nhật ngay, không cần đóng wizard rồi mở lại.
  const canCreateCashVoucher = useHasPermission('cash_voucher', 'create');
  const [cashVoucherModalOpen, setCashVoucherModalOpen] = useState(false);
  const createCashVoucherMutation = useCreateCashVoucherMutation();

  const blindQuery = useCashierShiftBlindCloseEnabledQuery();
  const summaryQuery = useCashierShiftSummaryQuery(shift.id);
  const clinicHeaderQuery = useClinicPrintHeaderQuery();
  const closeMutation = useCloseCashierShiftMutation(shift.id);

  async function handleCreateCashVoucher(dto: CashVoucherSubmitDto) {
    await createCashVoucherMutation.mutateAsync({
      direction: dto.direction!,
      incomeExpenseTypeCode: dto.incomeExpenseTypeCode,
      cashAccountId: dto.cashAccountId,
      paymentMethodCode: dto.paymentMethodCode,
      amount: dto.amount,
      occurredAt: dto.occurredAt,
      partnerName: dto.partnerName,
      description: dto.description,
      note: dto.note,
    });
  }

  const blind = blindQuery.data ?? true;
  const expected = summaryQuery.data?.expectedCashAmount ?? 0;
  const diff = countedAmount - expected;
  const submittedAmount = Math.max(countedAmount - keepAmount, 0);

  /**
   * "Tổng doanh thu ca" (`docs/DECISIONS.md` #120) — tiền mặt ròng + phi tiền mặt ròng, KHÔNG cộng
   * vốn đầu ca (không phải doanh thu phát sinh trong ca này). `nonCashBreakdown[].amount` đã trừ
   * hoàn tiền theo từng phương thức sẵn từ `computeCashierShiftTotals()` (`packages/core`) — không
   * cần gọi API/tính lại gì thêm ở đây.
   */
  const cashInAmount = summaryQuery.data?.cashInAmount ?? 0;
  const cashOutAmount = summaryQuery.data?.cashOutAmount ?? 0;
  const cashNet = cashInAmount - cashOutAmount;
  const nonCashBreakdown = summaryQuery.data?.nonCashBreakdown ?? [];
  const nonCashNet = nonCashBreakdown.reduce((sum, item) => sum + item.amount, 0);
  const totalRevenue = cashNet + nonCashNet;
  const cashPct = totalRevenue !== 0 ? Math.round((cashNet / totalRevenue) * 100) : 0;
  const nonCashPct = 100 - cashPct;

  async function handleConfirm() {
    setError(null);
    try {
      const updated = await closeMutation.mutateAsync({
        countedCashAmount: countedAmount,
        cashDiscrepancyReason: diff !== 0 ? discrepancyReason : undefined,
        keepForNextAmount: keepAmount,
        handoverNote: handoverNote.trim() === '' ? undefined : handoverNote,
        version: shift.version,
      });
      setClosedShift(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không chốt được ca, vui lòng thử lại.');
    }
  }

  const canGoNext =
    (step === 2 && countedAmount > 0) || (step === 3 && (diff === 0 || discrepancyReason.trim() !== '')) || step === 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="close-shift-title">
      {/* max-w-2xl (672px) x1.2 ≈ 806px — dãn thêm 20% theo yêu cầu chủ dự án khi xem trên bản chạy thật (2026-09-05). */}
      <div className="flex max-h-[92vh] w-full max-w-[806px] flex-col rounded-xl bg-white shadow-xl">
        <div className="flex-shrink-0 border-b border-slate-100 px-6 pt-6 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 id="close-shift-title" className="text-lg font-bold text-slate-900">
                Chốt ca
              </h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {shift.shiftLabel} · {shift.cashierName} · Mở lúc {new Date(shift.openedAt).toLocaleString('vi-VN')}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Đóng">
              <X size={20} weight="bold" aria-hidden="true" />
            </button>
          </div>

          {/* Lưới 4 cột ĐỀU NHAU — số và chữ nhãn dùng chung một cột nên luôn thẳng hàng (bản cũ
              tính 2 hàng riêng theo 2 công thức flex khác nhau — hàng số trừ đúng 26px của circle
              cuối, hàng chữ trừ theo bề rộng chữ "Bàn giao" — 2 mốc chia khác nhau nên bị lệch,
              phản hồi trực tiếp 2026-09-05). Đường nối vẽ NGẦM phía sau bằng 2 nửa mỗi cột (nửa
              trái nối cột trước, nửa phải nối cột sau), circle đè `z-10` lên trên. */}
          {!closedShift && (
            <div className="mt-5 grid grid-cols-4">
              {[1, 2, 3, 4].map((s, i) => {
                const isDone = s < step;
                const isActive = s === step;
                return (
                  <div key={s} className="relative flex flex-col items-center gap-2">
                    {i > 0 && <div className={`absolute left-0 right-1/2 top-3.75 h-0.5 ${s <= step ? 'bg-emerald-600' : 'bg-slate-200'}`} />}
                    {i < 3 && <div className={`absolute left-1/2 right-0 top-3.75 h-0.5 ${isDone ? 'bg-emerald-600' : 'bg-slate-200'}`} />}
                    <div
                      className={`relative z-10 flex h-7.5 w-7.5 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                        isDone ? 'bg-emerald-600 text-white' : isActive ? 'bg-emerald-600 text-white ring-4 ring-emerald-100' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {isDone ? <Check size={14} weight="bold" aria-hidden="true" /> : s}
                    </div>
                    <span className={`text-center text-[12.5px] font-semibold ${isActive ? 'text-emerald-600' : 'text-slate-500'}`}>{STEP_LABELS[i]}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="scroll-hover flex-1 overflow-y-auto px-6 py-5">
          {closedShift ? (
            <div>
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                Đã chốt ca thành công — dữ liệu đã khoá. Tài khoản vẫn đang đăng nhập bình thường.
              </div>
              {clinicHeaderQuery.data && <CashierShiftReceiptView shift={closedShift} clinicHeader={clinicHeaderQuery.data} onAfterPrint={onClose} />}
            </div>
          ) : (
            <>
              {step === 1 && (
                <div>
                  <p className="mb-4 text-sm font-medium text-slate-500">Hệ thống tự động tổng hợp mọi phiếu thu phát sinh trong ca — số liệu bên dưới không sửa được.</p>
                  {summaryQuery.isPending ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <>
                      {/* "Tổng doanh thu ca" (`docs/DECISIONS.md` #120) — hero chính của Bước 1, dùng
                          đúng khuôn panel "hệ thống tự tổng hợp" đã có tiền lệ ở `DoctorEndShiftDialog.tsx`. */}
                      {/* Kích thước thu nhỏ ~10% so với bản đầu theo phản hồi trực tiếp 2026-09-05
                          (padding/cỡ chữ/khoảng cách đều giảm 1 nấc). */}
                      <div className="rounded-xl border border-brand-teal/20 bg-brand-teal-panel px-4.5 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-[1.5px] border-brand-teal/30 bg-white text-brand-teal-active">
                            <Wallet size={18} weight="regular" aria-hidden="true" />
                          </div>
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-wide text-brand-teal-active">Tổng doanh thu ca</div>
                            <div className="text-[10px] font-medium text-brand-teal-active">Tiền mặt + các hình thức khác, đã trừ hoàn tiền</div>
                          </div>
                        </div>

                        {blind ? (
                          <div className="mt-3 text-[23px] font-bold tracking-[0.12em] text-brand-teal-active/60">*.***.*** đ</div>
                        ) : (
                          <div className="mt-3 text-[29px] font-bold text-slate-900">{formatVnd(totalRevenue)}</div>
                        )}

                        {!blind && totalRevenue > 0 && (
                          <div className="mt-3.5 flex h-2 overflow-hidden rounded-full bg-white/60" aria-hidden="true">
                            <div className="bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, cashPct))}%` }} />
                            <div className="bg-brand-teal-active" style={{ width: `${Math.max(0, Math.min(100, nonCashPct))}%` }} />
                          </div>
                        )}

                        <div className="mt-2.75 flex flex-wrap gap-4.5">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-teal-active">
                            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-600" aria-hidden="true" />
                            Tiền mặt{' '}
                            <span className="font-bold text-slate-900">{blind ? 'ẩn — hiện sau khi đếm' : `${formatVnd(cashNet)} · ${cashPct}%`}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-teal-active">
                            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand-teal-active" aria-hidden="true" />
                            Phi tiền mặt <span className="font-bold text-slate-900">{formatVnd(nonCashNet)} · {nonCashPct}%</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Tiền mặt — cần đếm tay để đối soát</div>
                      <div className="grid grid-cols-3 gap-3">
                        <SummaryCard label="Vốn đầu ca" value={formatVnd(shift.openingFloatActual)} />
                        <SummaryCard
                          label={`Tổng thu tiền mặt (${summaryQuery.data?.cashInCount ?? 0} phiếu)`}
                          value={blind ? '*.***.*** đ' : `+${formatVnd(cashInAmount)}`}
                          valueClassName={blind ? 'tracking-widest text-slate-300' : 'text-emerald-600'}
                        />
                        <SummaryCard
                          label={`Chi tiền mặt — hoàn tiền (${summaryQuery.data?.cashOutCount ?? 0} phiếu)`}
                          value={blind ? '*.***.*** đ' : `−${formatVnd(cashOutAmount)}`}
                          valueClassName={blind ? 'tracking-widest text-slate-300' : 'text-rose-600'}
                        />
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wide text-blue-600">Tiền mặt dự kiến trong két</div>
                          <div className="text-xs font-medium text-slate-500">Gồm {formatVnd(shift.openingFloatActual)} vốn đầu ca</div>
                        </div>
                        {blind ? (
                          <span className="text-lg font-bold tracking-widest text-blue-300">*.***.***</span>
                        ) : (
                          <span className="text-lg font-bold text-blue-700">{formatVnd(expected)}</span>
                        )}
                      </div>

                      {nonCashBreakdown.length > 0 && (
                        <>
                          <div className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Phi tiền mặt — đối chiếu qua sao kê, không cần đếm tay</div>
                          <div className="grid grid-cols-2 gap-3">
                            {nonCashBreakdown.map((item) => {
                              const negative = item.amount < 0;
                              return (
                                <div key={item.method} className={`flex items-center gap-3 rounded-lg border p-4 ${negative ? 'border-rose-200 bg-rose-50' : 'border-slate-200'}`}>
                                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${negative ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                                    {item.method === 'BANK_TRANSFER' ? <Bank size={18} weight="regular" aria-hidden="true" /> : <CreditCard size={18} weight="regular" aria-hidden="true" />}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-semibold text-slate-500">
                                      {item.methodLabel} · {item.count} giao dịch
                                    </div>
                                    <div className={`text-lg font-bold ${negative ? 'text-rose-600' : 'text-slate-900'}`}>
                                      {negative ? `−${formatVnd(Math.abs(item.amount))}` : formatVnd(item.amount)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {step === 2 && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-500">Đếm từng mệnh giá — hệ thống tự cộng tổng.</p>
                    <div className="flex flex-shrink-0 items-center gap-3">
                      {canCreateCashVoucher && (
                        <button
                          type="button"
                          onClick={() => setCashVoucherModalOpen(true)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                        >
                          <Vault size={13} weight="bold" aria-hidden="true" />
                          Lập phiếu thu/chi
                        </button>
                      )}
                      <button type="button" onClick={() => setDirectEntry((v) => !v)} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                        {directEntry ? 'Dùng máy tính mệnh giá' : 'Nhập trực tiếp tổng số tiền'}
                      </button>
                    </div>
                  </div>
                  {directEntry ? (
                    <div>
                      <label htmlFor="direct-total" className="mb-1.5 block text-sm font-semibold text-slate-800">
                        Tổng tiền mặt đếm được <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <MoneyInput
                          id="direct-total"
                          value={countedAmount}
                          onChange={(v) => setCountedAmount(v ?? 0)}
                          className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">đ</span>
                      </div>
                    </div>
                  ) : (
                    <DenominationCounter value={countedAmount} onChange={setCountedAmount} />
                  )}
                </div>
              )}

              {step === 3 && (
                <div>
                  <div className="mb-4 grid grid-cols-3 gap-3">
                    <SummaryCard label="Dự kiến" value={formatVnd(expected)} center />
                    <SummaryCard label="Thực đếm" value={formatVnd(countedAmount)} center />
                    <div className={`rounded-lg border-2 p-4 text-center ${diff === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
                      <div className={`text-[11px] font-bold uppercase tracking-wide ${diff === 0 ? 'text-emerald-600' : 'text-rose-500'}`}>Chênh lệch</div>
                      <div className={`mt-1 text-lg font-bold ${diff === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {diff === 0 ? '0 đ' : `${diff > 0 ? '+' : '−'}${formatVnd(Math.abs(diff))}`}
                      </div>
                    </div>
                  </div>

                  {diff === 0 ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                      Khớp tuyệt đối — không cần giải trình, có thể tiếp tục.
                    </div>
                  ) : (
                    <div>
                      <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">Có chênh lệch — bắt buộc giải trình trước khi tiếp tục.</div>
                      <label htmlFor="diff-reason" className="mb-1.5 block text-sm font-semibold text-slate-800">
                        Lý do chênh lệch <span className="text-rose-500">*</span>
                      </label>
                      <textarea
                        id="diff-reason"
                        rows={3}
                        required
                        value={discrepancyReason}
                        onChange={(e) => setDiscrepancyReason(e.target.value)}
                        placeholder="Ví dụ: trả nhầm tiền thừa cho khách lúc 10:20, khách chuyển khoản nhưng quên ghi nhận..."
                        className="w-full rounded-md border border-rose-300 bg-white px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                  )}
                </div>
              )}

              {step === 4 && (
                <div>
                  <label htmlFor="handover-keep" className="mb-1.5 block text-sm font-semibold text-slate-800">
                    Tiền mặt để lại làm vốn cho ca sau
                  </label>
                  <div className="relative">
                    <MoneyInput
                      id="handover-keep"
                      value={keepAmount}
                      onChange={(v) => setKeepAmount(v ?? 0)}
                      className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">đ</span>
                  </div>

                  <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 p-4">
                    <span className="text-sm font-semibold text-slate-700">Tiền mặt nộp về (chủ phòng khám / kế toán)</span>
                    <span className="text-xl font-bold text-blue-700">{formatVnd(submittedAmount)}</span>
                  </div>

                  <div className="mt-4">
                    <label htmlFor="handover-note" className="mb-1.5 block text-sm font-semibold text-slate-800">
                      Ghi chú bàn giao <span className="font-normal normal-case text-slate-400">(tuỳ chọn)</span>
                    </label>
                    <textarea
                      id="handover-note"
                      rows={2}
                      value={handoverNote}
                      onChange={(e) => setHandoverNote(e.target.value)}
                      placeholder="Ví dụ: đã kiểm tra cùng Quản lý ca, tiền đã cất vào két sắt văn phòng."
                      className="w-full rounded-md border border-slate-300 px-3.5 py-2.5 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  <div className="mt-4 flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-xs font-medium text-amber-800">
                      Sau khi xác nhận, dữ liệu ca này bị khoá hoàn toàn — bạn không tự sửa lại được. Muốn sửa/huỷ phải có tài khoản Quản lý duyệt mở khoá.
                    </p>
                  </div>

                  {error && <p className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
                </div>
              )}
            </>
          )}
        </div>

        {!closedShift && (
          <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-100 px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)} className={step === 1 ? 'invisible' : ''}>
              Quay lại
            </Button>
            {step < 4 ? (
              <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canGoNext}>
                Tiếp tục
              </Button>
            ) : (
              <Button type="button" onClick={() => void handleConfirm()} loading={closeMutation.isPending}>
                Xác nhận chốt ca & in phiếu
              </Button>
            )}
          </div>
        )}
      </div>
      {cashVoucherModalOpen && (
        <CashVoucherFormDialog
          mode="create"
          submitting={createCashVoucherMutation.isPending}
          onCancel={() => setCashVoucherModalOpen(false)}
          onSubmit={handleCreateCashVoucher}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, valueClassName, center }: { label: string; value: string; valueClassName?: string; center?: boolean }) {
  return (
    <div className={`rounded-lg border border-slate-200 p-4 ${center ? 'text-center' : ''}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-bold text-slate-900 ${valueClassName ?? ''}`}>{value}</div>
    </div>
  );
}
